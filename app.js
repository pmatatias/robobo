import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import cors from "cors";
import crypto from "crypto";
import bodyParser from "body-parser";
import COS from "cos-nodejs-sdk-v5";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

console.log("Loading .env from", path.resolve(".env"));
dotenv.config();

// === Tencent COS setup ===
const cos = new COS({
  SecretId: process.env.TENCENT_COS_SECRET_ID,
  SecretKey: process.env.TENCENT_COS_SECRET_KEY,
});
const COS_BUCKET = process.env.TENCENT_COS_BUCKET; 
const COS_REGION = process.env.TENCENT_COS_REGION; 

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes (development)
app.use(cors());

// Swagger/OpenAPI setup
const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "Robocall Assistant API",
    version: "1.0.0",
    description: "API for managing ElevenLabs assistants and agent_id lookup"
  },
  servers: [
    { url: "http://localhost:3001", description: "Local server" }
  ]
};
const swaggerOptions = {
  swaggerDefinition,
  apis: ["./app.js"]
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// === MongoDB connection setup ===
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://<username>:<password>@<cluster-url>/<dbname>?retryWrites=true&w=majority";
const DB_NAME = process.env.DB_NAME || "robocall_db";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "assistants";

let db, assistantsCollection, postcallCollection, robocallTicketsCollection;

/**
 * Connect to MongoDB once at startup
 * Also set up the tickets collection
 * Also set up the postcall collection
 * Also set up the robocall_tickets collection
 */
async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  assistantsCollection = db.collection(COLLECTION_NAME);
  postcallCollection = db.collection("postcall");
  robocallTicketsCollection = db.collection("robocall_tickets");
  console.log("Connected to MongoDB");
}
connectToMongo().catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});


/**
 * @openapi
 * /webhook/ticket:
 *   post:
 *     summary: Webhook to create a new ticket
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *               [other fields as needed]:
 *                 type: string
 *     responses:
 *       201:
 *         description: Ticket created
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
/**
 * Generate a unique 6-character alphanumeric ticket number (uppercase letters and digits)
 * @param {Collection} collection - MongoDB collection to check for uniqueness
 * @returns {Promise<string>} - Unique ticket number
 */
async function generateUniqueTicketNumber(collection) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ticket_number, exists, tries = 0, maxTries = 5;
  do {
    ticket_number = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    exists = await collection.findOne({ ticket_number });
    tries++;
  } while (exists && tries < maxTries);
  if (exists) throw new Error("Failed to generate unique ticket number");
  return ticket_number;
}

/**
 * @openapi
 * /webhook/elevenlabs:
 *   post:
 *     summary: Receive ElevenLabs post_call_transcription webhook and store in DB
 *     description: |
 *       Receives ElevenLabs webhook events (post_call_transcription) and stores them in the database after validating HMAC signature.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received and stored
 *       401:
 *         description: Invalid signature
 *       403:
 *         description: Request expired
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
/**
 * Create a robocall ticket in robocall_tickets collection from an ElevenLabs event
 * @param {object} event - The parsed ElevenLabs event (post_call_transcription)
 * @returns {Promise<string>} The created ticket number
 */
async function create_robocall_ticket(event) {
  // Support both top-level and .data wrapped event structure
  const data = event.data || event;

  // Extract analysis fields for top-level mapping (do not remove from analysis)
  let subject = "", category = "", customer_name = "", priority = "low";
  if (data.analysis && data.analysis.data_collection_results) {
    const dcr = data.analysis.data_collection_results;
    subject = dcr.subject?.value || "";
    category = dcr.category?.value || "";
    customer_name = dcr.customer_name?.value || "";
    priority = dcr.priority?.value || "low";
  }

  // Build call_transcription object
  const now = new Date();
  const event_timestamp = data?.metadata?.start_time_unix_secs || data?.metadata?.accepted_time_unix_secs || Math.floor(Date.now() / 1000);
  function cleanTranscript(transcript) {
    if (!Array.isArray(transcript)) return [];
    return transcript.map(turn => ({
      role: turn.role,
      message: turn.message,
      time_in_call_secs: turn.time_in_call_secs,
      interrupted: turn.interrupted
    }));
  }
  const call_transcription = {
    event_timestamp,
    data: {
      agent_id: data.agent_id,
      conversation_id: data.conversation_id,
      status: data.status,
      user_id: data.user_id,
      transcript: cleanTranscript(data.transcript),
      metadata: data.metadata,
      analysis: data.analysis,
      received_at: now
    }
  };

  // Check for existing ticket with same agent_id and conversation_id
  const existing = await robocallTicketsCollection.findOne({
    "call_transcription.data.agent_id": data.agent_id,
    "call_transcription.data.conversation_id": data.conversation_id
  });

  if (existing) {
    // Update the existing ticket
    const updateFields = {
      subject,
      category,
      customer_name,
      priority,
      call_transcription,
      ticket_status: "closed",
      eval: null,
      updated_at: now
    };
    await robocallTicketsCollection.updateOne(
      { _id: existing._id },
      { $set: updateFields }
    );
    console.log("Updated robocall ticket:", existing.ticket_number);
    return { ...existing, ...updateFields }; // Return the updated existing ticket
  } else {
    // Generate unique ticket number for robocall_tickets
    const ticket_number = await generateUniqueTicketNumber(robocallTicketsCollection);

    const ticketDoc = {
      ticket_number,
      ticket_status: "closed",
      subject,
      category,
      customer_name,
      priority,
      eval: null,
      call_transcription,
      created_at: now // Add created_at for new tickets
    };
    const result = await robocallTicketsCollection.insertOne(ticketDoc);
    console.log("Inserted robocall ticket:", ticket_number);
    return { _id: result.insertedId, ...ticketDoc }; // Return the newly inserted ticket with its _id
  }
}

/**
 * POST /webhook/robocall-ticket/update-status
 * Body: { ticket_number: string, ticket_status: string }
 * Updates ticket_status for a robocall ticket
 */
app.post("/webhook/robocall-ticket/update-status", express.json(), async (req, res) => {
  let { ticket_number, ticket_status, agent_id } = req.body;
  if (!ticket_number || !ticket_status) {
    return res.status(400).json({ error: "Missing required fields: ticket_number, ticket_status" });
  }
  // Remove all spaces from ticket_number and agent_id (if present)
  ticket_number = typeof ticket_number === "string" ? ticket_number.replace(/\s+/g, "") : ticket_number;
  if (agent_id) agent_id = typeof agent_id === "string" ? agent_id.replace(/\s+/g, "") : agent_id;
  try {
    const query = { ticket_number };
    if (agent_id) query.agent_id = agent_id;
    const result = await robocallTicketsCollection.updateOne(
      query,
      { $set: { ticket_status, updated_at: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json({ message: "Ticket status updated", ticket_number, ticket_status });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /webhook/robocall-ticket/status
 * Body: { ticket_number: string }
 * Returns: { ticket_number, ticket_status, subject }
 */
app.post("/webhook/robocall-ticket/status", express.json(), async (req, res) => {
  let { ticket_number } = req.body;
  if (!ticket_number) {
    return res.status(400).json({ error: "Missing required field: ticket_number" });
  }
  // Remove all spaces from ticket_number and agent_id (if present)
  ticket_number = typeof ticket_number === "string" ? ticket_number.replace(/\s+/g, "") : ticket_number;
  try {
    const query = { ticket_number };
    const ticket = await robocallTicketsCollection.findOne(query);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json({
      ticket_number: ticket.ticket_number,
      ticket_status: ticket.ticket_status || "open",
      subject: ticket.subject || ""
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /webhook/robocall-ticket
 * Body: { subject, category, customer_name, priority, agent_id, conversation_id }
 * Returns: { ticket_number, ticket_status, subject, ... }
 */
app.post("/webhook/robocall-ticket", express.json(), async (req, res) => {
  const { subject, category, customer_name, priority, agent_id, conversation_id } = req.body;
  if (!subject || !agent_id || !conversation_id) {
    return res.status(400).json({ error: "Missing required fields: subject, agent_id, conversation_id" });
  }
  try {
    // Generate unique ticket number
    const ticket_number = await generateUniqueTicketNumber(robocallTicketsCollection);

    // Minimal call_transcription object
    const call_transcription = {
      data: {
        agent_id,
        conversation_id
      }
    };

    const ticketDoc = {
      ticket_number,
      ticket_status: "open",
      subject,
      category: category || "",
      customer_name: customer_name || "",
      priority: priority || "low",
      call_transcription,
      created_at: new Date()
    };

    await robocallTicketsCollection.insertOne(ticketDoc);
    res.status(201).json({ message: "Ticket has been created with number:", ticket_number });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});





/**
 * GET /api/robocall-tickets
 * Query param: agent_id (optional), ticket_number (optional)
 * Returns all tickets, or those matching call_transcription.data.agent_id or ticket_number
 */
import { ObjectId } from "mongodb";

app.get("/api/robocall-tickets", async (req, res) => {
  try {
    let { agent_id, ticket_number, sort } = req.query;
    let query = {};
    if (agent_id) {
      // Support both flat and nested ticket structures
      query.$or = [
        { "call_transcription.data.agent_id": agent_id },
        { agent_id }
      ];
    }
    if (ticket_number) {
      query.ticket_number = ticket_number;
    }

    // Default sort: most recent first (created_at desc, fallback to _id desc)
    let sortObj = { created_at: -1, _id: -1 };
    if (sort) {
      // Support sort=field:asc or sort=field:desc
      const [field, dir] = sort.split(":");
      if (field) {
        sortObj = { [field]: dir === "asc" ? 1 : -1 };
      }
    }

    const tickets = await robocallTicketsCollection.find(query).sort(sortObj).toArray();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});


/**
 * @openapi
 * /trigger_qa_robocall:
 *   post:
 *     summary: Triggers a QA robocall evaluation with provided ticket JSON data.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               _id:
 *                 oneOf:
 *                   - type: string
 *                   - type: object
 *                     properties:
 *                       $oid:
 *                         type: string
 *                 description: The MongoDB ObjectId of the ticket.
 *               ticket_number:
 *                 type: string
 *               customer_name:
 *                 type: string
 *               call_transcript:
 *                 type: object
 *               status:
 *                 type: string
 *             example:
 *               _id: { "$oid": "65c7e2f1a1b2c3d4e5f6a7b8" }
 *               ticket_number: "TICKET-001"
 *               customer_name: "John Doe"
 *               call_transcript: {}
 *               status: "open"
 *     responses:
 *       200:
 *         description: Ticket evaluated and updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 evaluation_result:
 *                   type: object
 *       400:
 *         description: Invalid input.
 *       500:
 *         description: Server error.
 */
app.post("/trigger_qa_robocall", express.json(), async (req, res) => {
  const ticketData = req.body;
  if (!ticketData || !ticketData._id) {
    return res.status(400).json({ error: "Missing required ticket data or _id" });
  }

  try {
    // const qaRobocallUrl = "https://1bbmxz17-8000.asse.devtunnels.ms/trigger_qa_robocall";
    const qaRobocallUrl = "https://qarobocall-production.up.railway.app/trigger_qa_robocall";
    const response = await fetch(qaRobocallUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ticketData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to trigger QA robocall: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: `Failed to trigger QA robocall: ${errorText}` });
    }

    const result = await response.json();
    console.log("QA robocall triggered successfully:", result);

    // Update the robocall ticket with the evaluation result
    const ticketId = typeof ticketData._id === 'string' ? new ObjectId(ticketData._id) : new ObjectId(ticketData._id.$oid);
    await robocallTicketsCollection.updateOne(
      { _id: ticketId },
      { $set: { eval: result.evaluation_result, updated_at: new Date() } }
    );
    console.log(`Updated robocall ticket ${ticketData._id} with QA evaluation result.`);

    res.status(200).json(result);
  } catch (err) {
    console.error("Error triggering QA robocall:", err);
    res.status(500).json({ error: "Server error when triggering QA robocall" });
  }
});


/**
 * GET /api/robocall-tickets/pending-eval
 * Query: limit (default 100, max 1000), after_id (ObjectId as string)
 * Returns a page of tickets where eval is null, sorted by _id ascending
 */
app.get("/api/robocall-tickets/pending-eval", async (req, res) => {
  try {
    let { limit } = req.query;
    limit = Math.min(parseInt(limit) || 1000, 1000); // Default to 1000, max 1000
    const query = { eval: null };
    const tickets = await robocallTicketsCollection
      .find(query)
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post(
  "/webhook/elevenlabs/postcall",
  bodyParser.raw({ type: "application/json", limit: "20mb" }),
  async (req, res) => {
    console.log("POST /webhook/elevenlabs/postcall called");
    try {
      const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
      if (!secret) {
        console.error("Webhook secret not configured");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }
      const signatureHeader = req.headers["elevenlabs-signature"] || req.headers["ElevenLabs-Signature"] || req.headers["ELEVENLABS-SIGNATURE"];
      if (!signatureHeader) {
        console.error("Missing signature header");
        return res.status(401).json({ error: "Missing signature header" });
      }
      const headers = signatureHeader.split(",");
      const timestamp = headers.find((e) => e.startsWith("t="))?.substring(2);
      const signature = headers.find((e) => e.startsWith("v0="));
      if (!timestamp || !signature) {
        console.error("Invalid signature format", signatureHeader);
        return res.status(401).json({ error: "Invalid signature format" });
      }
      // Validate timestamp (30 min tolerance)
      const reqTimestamp = Number(timestamp) * 1000;
      const tolerance = Date.now() - 30 * 60 * 1000;
      if (reqTimestamp < tolerance) {
        console.error("Request expired", { reqTimestamp, tolerance });
        return res.status(403).json({ error: "Request expired" });
      }
      // Validate HMAC
      // Log raw body and message for debugging
      console.log("Raw body (hex):", req.body.toString("hex"));
      // Use raw buffer for HMAC calculation
      const message = Buffer.concat([
        Buffer.from(timestamp + ".", "utf-8"),
        req.body
      ]);
      // console.log("HMAC message (buffer):", message);
      // Masked secret info for debugging
      console.log("Secret info: length =", secret.length, "first char =", secret[0], "last char =", secret[secret.length-1]);
      const digest = "v0=" + crypto.createHmac("sha256", secret).update(message).digest("hex");
      if (signature !== digest) {
        console.error("Invalid signature", { signature, digest });
        return res.status(401).json({ error: "Invalid signature" });
      }
      // Parse JSON
      let event;
      try {
        const bodyString = req.body.toString("utf-8");
        event = JSON.parse(bodyString);
      } catch (e) {
        console.error("Invalid JSON", req.body.toString("utf-8"));
        return res.status(400).json({ error: "Invalid JSON" });
      }
      console.log("Parsed event:", event);

      // Handle both post_call_transcription and post_call_audio
      if (event.type === "post_call_transcription") {
        // Store in DB
        const dbResult = await postcallCollection.insertOne({
          ...event,
          received_at: new Date()
        });
        console.log("Inserted post_call_transcription into DB:", dbResult.insertedId);

        // Also create a robocall ticket (log errors but don't block webhook)
        try {
          const createdTicket = await create_robocall_ticket(event); // Get the created ticket's full document
          if (createdTicket && createdTicket._id) {
            // Trigger QA robocall in the background (non-blocking)
            triggerQaRobocall(
              createdTicket.ticket_number,
              createdTicket.call_transcription?.data?.agent_id,
              createdTicket.call_transcription?.data?.conversation_id
            );
          }
        } catch (ticketErr) {
          console.error("Failed to create or trigger QA robocall ticket:", ticketErr);
        }

        return res.status(200).json({ message: "post_call_transcription received and stored" });
      } else if (event.type === "post_call_audio") {
        // Handle audio: decode base64 and upload to COS
        try {
          const { agent_id, conversation_id, full_audio } = event.data || {};
          const event_timestamp = event.event_timestamp;
          if (!agent_id || !conversation_id || !full_audio) {
            return res.status(400).json({ error: "Missing agent_id, conversation_id, or full_audio in post_call_audio" });
          }
          const audioBuffer = Buffer.from(full_audio, "base64");
          const key = `audio-call/${agent_id}/${conversation_id}.mp3`;
          cos.putObject(
            {
              Bucket: COS_BUCKET,
              Region: COS_REGION,
              Key: key,
              Body: audioBuffer,
              ContentType: "audio/mpeg",
            },
            async (err, data) => {
              if (err) {
                console.error("COS upload error:", err);
                return res.status(500).json({ error: "Failed to upload audio to COS", details: err });
              }
              // Success
              const fileUrl = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;
              // Store metadata in MongoDB
              try {
                await postcallCollection.insertOne({
                  type: "post_call_audio",
                  event_timestamp,
                  data: {
                    agent_id,
                    conversation_id,
                    audio_url: fileUrl
                  },
                  received_at: new Date()
                });

                // Upsert ticket in robocallTicketsCollection to include audio_url
                await robocallTicketsCollection.updateOne(
                  {
                    "call_transcription.data.agent_id": agent_id,
                    "call_transcription.data.conversation_id": conversation_id
                  },
                  {
                    $set: {
                      "call_transcription.data.audio_url": fileUrl
                    }
                  },
                  { upsert: true }
                );
              } catch (mongoErr) {
                console.error("Failed to store post_call_audio metadata in MongoDB:", mongoErr);
                // Still return success for audio upload, but log the DB error
              }
              res.status(200).json({ message: "Audio uploaded", url: fileUrl });
            }
          );
        } catch (err) {
          console.error("Error handling post_call_audio:", err);
          return res.status(500).json({ error: "Server error handling post_call_audio" });
        }
      } else {
        // Per ElevenLabs docs: always return 200 for valid, authenticated requests, even if event type is ignored.
        console.log("Webhook event type ignored:", event.type);
        return res.status(200).json({ message: "Event type ignored" });
      }
    } catch (err) {
      console.error("Error in webhook handler:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);



/**
 * @openapi
 * /api/signed-url/{slug}:
 *   get:
 *     summary: Get a signed URL for an assistant by slug (for ElevenLabs)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Signed URL and assistant info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signedUrl:
 *                   type: string
 *                 name:
 *                   type: string
 *                 calling_page_enable:
 *                   type: boolean
 *       404:
 *         description: Assistant not found
 *       403:
 *         description: Assistant disabled
 *       500:
 *         description: Error generating signed URL
 */
app.get("/api/signed-url/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const assistant = await assistantsCollection.findOne({ slug });
    console.log("Assistant retrieved from DB:", assistant); // Debugging line
    if (!assistant) {
      return res.status(404).json({ error: "Assistant not found" });
    }
    if (assistant.disabled || assistant.calling_page_enable === false) {
      return res.status(403).json({ error: "Assistant disabled" });
    }
    if (!assistant.agent_id || !assistant.apiKey) {
      console.error("Missing agent_id or apiKey for assistant:", assistant); // Debugging line
      return res.status(500).json({ error: "Missing agent_id or apiKey for this assistant" });
    }
    // Request signed URL from ElevenLabs
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${assistant.agent_id}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": assistant.apiKey,
        },
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get signed URL from ElevenLabs: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    res.json({
      signedUrl: data.signed_url,
      name: assistant.name,
      calling_page_enable: assistant.calling_page_enable
    });
  } catch (err) {
    console.error("Error generating signed URL:", err);
    res.status(500).json({ error: err.message || "Failed to generate signed URL" });
  }
});

/**
 * @openapi
 * /api/upload-mp3:
 *   post:
 *     summary: Upload an mp3 file, generate agent_id and conversation_id, and store in COS bucket.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agent_id:
 *                   type: string
 *                 conversation_id:
 *                   type: string
 *                 url:
 *                   type: string
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept any audio file
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio files are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
});

/**
 * Trigger QA robocall in the background (non-blocking)
 * @param {string} ticket_number
 * @param {string} agent_id
 * @param {string} conversation_id
 */
function triggerQaRobocall(ticket_number, agent_id, conversation_id) {
  (async () => {
    try {
      // const qaRobocallUrl = "https://1bbmxz17-8000.asse.devtunnels.ms/trigger_qa_robocall";
      const qaRobocallUrl = "https://qarobocall-production.up.railway.app/trigger_qa_robocall";
      const qaPayload = {
        ticket_number,
        agent_id,
        conversation_id
      };
      await fetch(qaRobocallUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(qaPayload),
      });
    } catch (qaErr) {
      console.error("Failed to trigger QA robocall after upload-audio:", qaErr);
    }
  })();
}

app.post("/api/upload-audio", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // Generate agent_id and conversation_id with required prefixes
    const agent_id = "agent_upload_audio_qa";
    const conversation_id = "conv_" + uuidv4().replace(/-/g, "").slice(0, 24);

    // Get file extension from original name or mimetype
    let ext = "";
    if (req.file.originalname && req.file.originalname.includes(".")) {
      ext = req.file.originalname.substring(req.file.originalname.lastIndexOf("."));
    } else if (req.file.mimetype) {
      // fallback: map common audio mimetypes to extension
      const mimeMap = {
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/x-pn-wav": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/x-flac": ".flac",
        "audio/flac": ".flac"
      };
      ext = mimeMap[req.file.mimetype] || "";
    }
    if (!ext) ext = ".audio"; // fallback

    const key = `audio-call/${agent_id}/${conversation_id}${ext}`;

    cos.putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      },
      (err, data) => {
        if (err) {
          console.error("COS upload error:", err);
          return res.status(500).json({ error: "Failed to upload file to COS", details: err });
        }
        const fileUrl = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;

        // After successful upload, generate ticket and store in DB
        (async () => {
          try {
            const ticket_number = await generateUniqueTicketNumber(robocallTicketsCollection);
            await robocallTicketsCollection.insertOne({
              ticket_number,
              call_transcription: {
                data: {
                  agent_id,
                  conversation_id,
                  audio_url: fileUrl
                }
              }
            });

            // Trigger QA robocall in the background (non-blocking)
            triggerQaRobocall(ticket_number, agent_id, conversation_id);

            res.status(200).json({
              agent_id,
              conversation_id,
              url: fileUrl,
              extension: ext,
              ticket_number
            });
          } catch (ticketErr) {
            console.error("Error creating ticket after audio upload:", ticketErr);
            res.status(500).json({ error: "Audio uploaded but failed to create ticket", details: ticketErr });
          }
        })();
      }
    );
  } catch (err) {
    console.error("Error in /api/upload-audio-call:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

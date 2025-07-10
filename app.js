import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import cors from "cors";
import crypto from "crypto";
import bodyParser from "body-parser";

dotenv.config();

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

let db, assistantsCollection, ticketsCollection, postcallTranscriptionsCollection, robocallTicketsCollection;

/**
 * Connect to MongoDB once at startup
 * Also set up the tickets collection
 * Also set up the postcall transcriptions collection
 * Also set up the robocall_tickets collection
 */
async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  assistantsCollection = db.collection(COLLECTION_NAME);
  ticketsCollection = db.collection("tickets");
  postcallTranscriptionsCollection = db.collection("postcall_transcriptions");
  robocallTicketsCollection = db.collection("robocall_tickets");
  console.log("Connected to MongoDB");
}
connectToMongo().catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});

/**
 * @openapi
 * /api/agent-id:
 *   get:
 *     summary: List all assistants
 *     responses:
 *       200:
 *         description: Array of assistants
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   slug:
 *                     type: string
 *                   agent_id:
 *                     type: string
 */
app.get("/api/agent-id", async (req, res) => {
  try {
    const assistants = await assistantsCollection.find({ disabled: { $ne: true } }).toArray();
    res.json(assistants.map(({ name, slug, agent_id }) => ({ name, slug, agent_id })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @openapi
 * /api/admin/agent-id:
 *   get:
 *     summary: List all assistants including disabled ones (for admin purposes)
 *     responses:
 *       200:
 *         description: Array of all assistants
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   slug:
 *                     type: string
 *                   agent_id:
 *                     type: string
 *                   disabled:
 *                     type: boolean
 */
app.get("/api/admin/agent-id", async (req, res) => {
  try {
    const assistants = await assistantsCollection.find({}).toArray();
    res.json(assistants.map(({ name, slug, agent_id, disabled }) => ({ name, slug, agent_id, disabled: !!disabled })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @openapi
 * /api/agent-id/{slug}:
 *   get:
 *     summary: Fetch assistant by slug
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assistant found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agent_id:
 *                   type: string
 *                 name:
 *                   type: string
 *       404:
 *         description: Assistant not found
 */
app.get("/api/agent-id/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const assistant = await assistantsCollection.findOne({ slug });
    if (!assistant) {
      return res.status(404).json({ error: "Assistant not found" });
    }
    if (assistant.disabled) {
      return res.status(403).json({ error: "Assistant disabled" });
    }
    res.json({
      agent_id: assistant.agent_id,
      name: assistant.name
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @openapi
 * /api/agent-id:
 *   post:
 *     summary: Create a new assistant
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *               - agent_id
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               agent_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Assistant created
 *       409:
 *         description: Assistant with this slug already exists
 */
app.post("/api/agent-id", express.json(), async (req, res) => {
  const { name, slug, agent_id, disabled } = req.body;
  if (!name || !slug || !agent_id) {
    return res.status(400).json({ error: "Missing required fields: name, slug, agent_id" });
  }
  try {
    // Check for duplicate slug
    const exists = await assistantsCollection.findOne({ slug });
    if (exists) {
      return res.status(409).json({ error: "Assistant with this slug already exists" });
    }
    const result = await assistantsCollection.insertOne({ name, slug, agent_id, disabled: !!disabled });
    res.status(201).json({ message: "Assistant created", id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @openapi
 * /api/agent-id/{slug}:
 *   put:
 *     summary: Update an existing assistant by slug
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               agent_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Assistant updated
 *       404:
 *         description: Assistant not found
 */
app.put("/api/agent-id/:slug", express.json(), async (req, res) => {
  const { slug } = req.params;
  const { name, agent_id, disabled } = req.body;
  if (!name && !agent_id && typeof disabled === "undefined") {
    return res.status(400).json({ error: "At least one of name, agent_id, or disabled must be provided" });
  }
  try {
    const update = {};
    if (name) update.name = name;
    if (agent_id) update.agent_id = agent_id;
    if (typeof disabled !== "undefined") update.disabled = !!disabled;
    const result = await assistantsCollection.updateOne(
      { slug },
      { $set: update }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Assistant not found" });
    }
    if (typeof disabled !== "undefined" && !!disabled === true) {
      return res.json({ message: "Assistant disabled" });
    }
    res.json({ message: "Assistant updated" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
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
 * Generate a unique 6-character alphanumeric ticket number for ticketsCollection
 */
async function generateTicketNumber() {
  return generateUniqueTicketNumber(ticketsCollection);
}


app.post("/webhook/ticket", express.json(), async (req, res) => {
  const { subject, description, priority, customer_name, agent_id, status } = req.body;
  if (!subject) {
    return res.status(400).json({ error: "Missing required field: subject" });
  }
  try {
    const ticket_number = await generateTicketNumber();
    const ticket = {
      ticket_number,
      subject,
      status: ticket.status || "open",
      description: description || "",
      priority: priority || "normal",
      customer_name: customer_name || "",
      agent_id: agent_id || "",
      created_at: new Date()
    };
    const result = await ticketsCollection.insertOne(ticket);
    res.status(201).json({ message: "Ticket created", ticket_number, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /webhook/ticket/status
 * Body: { ticket_number: string }
 * Returns: ticket status and details
 */
app.post("/webhook/ticket/status", express.json(), async (req, res) => {
  const { ticket_number, agent_id } = req.body;
  if (!ticket_number) {
    return res.status(400).json({ error: "Missing required field: ticket_number" });
  }
  try {
    const query = { ticket_number };
    if (agent_id) query.agent_id = agent_id;
    const ticket = await ticketsCollection.findOne(query);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json({
      ticket_number: ticket.ticket_number,
      status: ticket.status || "open",
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      customer_name: ticket.customer_name,
      agent_id: ticket.agent_id || "",
      created_at: ticket.created_at
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @openapi
 * /api/tickets:
 *   get:
 *     summary: Get list of all tickets
 *     parameters:
 *       - in: query
 *         name: agent_id
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter tickets by agent_id
 *     responses:
 *       200:
 *         description: Array of tickets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   ticket_number:
 *                     type: string
 *                   subject:
 *                     type: string
 *                   status:
 *                     type: string
 *                   description:
 *                     type: string
 *                   priority:
 *                     type: string
 *                   customer_name:
 *                     type: string
 *                   agent_id:
 *                     type: string
 *                   created_at:
 *                     type: string
 *                     format: date-time
 */
app.get("/api/tickets", async (req, res) => {
  try {
    const { agent_id } = req.query;
    const query = agent_id ? { agent_id } : {};
    const tickets = await ticketsCollection.find(query).toArray();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /webhook/ticket/update-status
 * Body: { ticket_number: string, status: string }
 * Updates ticket status
 */
app.post("/webhook/ticket/update-status", express.json(), async (req, res) => {
  const { ticket_number, agent_id, status } = req.body;
  if (!ticket_number || !status) {
    return res.status(400).json({ error: "Missing required fields: ticket_number, status" });
  }
  try {
    const query = { ticket_number };
    if (agent_id) query.agent_id = agent_id;
    const result = await ticketsCollection.updateOne(
      query,
      { $set: { status, updated_at: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json({ message: "Ticket status updated", ticket_number, agent_id: agent_id || "", status });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

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
 * Query param: agent_id (optional)
 * Returns all tickets, or those matching call_transcription.data.agent_id
 */
import { ObjectId } from "mongodb";

app.get("/api/robocall-tickets", async (req, res) => {
  try {
    let { agent_id } = req.query;
    let query = {};
    if (agent_id) {
      // Support both flat and nested ticket structures
      query = {
        $or: [
          { "call_transcription.data.agent_id": agent_id },
          { agent_id }
        ]
      };
    }
    const tickets = await robocallTicketsCollection.find(query).toArray();
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


app.post(
  "/webhook/elevenlabs/postcall",
  bodyParser.raw({ type: "*/*" }),
  async (req, res) => {
    // Debug: log entry and headers
    console.log("POST /webhook/elevenlabs/postcall called");
    console.log("Headers:", req.headers);
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
      const bodyString = req.body.toString("utf-8");
      console.log("Body as utf-8 string:", bodyString);
      const message = `${timestamp}.${bodyString}`;
      console.log("HMAC message:", message);
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
        event = JSON.parse(bodyString);
      } catch (e) {
        console.error("Invalid JSON", bodyString);
        return res.status(400).json({ error: "Invalid JSON" });
      }
      console.log("Parsed event:", event);
      // Only store post_call_transcription events in MongoDB.
      if (event.type !== "post_call_transcription") {
        // Per ElevenLabs docs: always return 200 for valid, authenticated requests, even if event type is ignored.
        console.log("Webhook event type ignored (not post_call_transcription):", event.type);
        return res.status(200).json({ message: "Event type ignored" });
      }
      // Store in DB
      const dbResult = await postcallTranscriptionsCollection.insertOne({
        ...event,
        received_at: new Date()
      });
      console.log("Inserted post_call_transcription into DB:", dbResult.insertedId);

      // Also create a robocall ticket (log errors but don't block webhook)
      try {
        const createdTicket = await create_robocall_ticket(event); // Get the created ticket's full document
        if (createdTicket && createdTicket._id) {
          const qaRobocallUrl = "https://qarobocall-production.up.railway.app/trigger_qa_robocall";
          const qaPayload = {
            _id: { "$oid": createdTicket._id.toHexString() },
            ticket_number: createdTicket.ticket_number,
            customer_name: createdTicket.customer_name || "",
            call_transcript: createdTicket.call_transcription?.data?.transcript || {},
            status: createdTicket.ticket_status || "closed"
          };

          const qaResponse = await fetch(qaRobocallUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(qaPayload),
          });

          if (qaResponse.ok) {
            const qaResult = await qaResponse.json();
            console.log("Successfully triggered QA robocall for ticket:", createdTicket.ticket_number, "Result:", qaResult);
            // Update the robocall ticket with the evaluation result
            await robocallTicketsCollection.updateOne(
              { _id: createdTicket._id },
              { $set: { eval: qaResult.evaluation_result, updated_at: new Date() } }
            );
            console.log(`Updated robocall ticket ${createdTicket.ticket_number} with QA evaluation result.`);
          } else {
            const errorText = await qaResponse.text();
            console.error("Failed to trigger QA robocall for ticket:", createdTicket.ticket_number, "Error:", errorText);
          }
        }
      } catch (ticketErr) {
        console.error("Failed to create or trigger QA robocall ticket:", ticketErr);
      }

      return res.status(200).json({ message: "Webhook received and stored" });
    } catch (err) {
      console.error("Error in webhook handler:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);


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




// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

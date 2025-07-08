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

let db, assistantsCollection, ticketsCollection, postcallTranscriptionsCollection;

/**
 * Connect to MongoDB once at startup
 * Also set up the tickets collection
 * Also set up the postcall transcriptions collection
 */
async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  assistantsCollection = db.collection(COLLECTION_NAME);
  ticketsCollection = db.collection("tickets");
  postcallTranscriptionsCollection = db.collection("postcall_transcriptions");
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
 */
async function generateTicketNumber() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ticket_number, exists, tries = 0, maxTries = 5;
  do {
    ticket_number = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    exists = await ticketsCollection.findOne({ ticket_number });
    tries++;
  } while (exists && tries < maxTries);
  if (exists) throw new Error("Failed to generate unique ticket number");
  return ticket_number;
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
      return res.status(200).json({ message: "Webhook received and stored" });
    } catch (err) {
      console.error("Error in webhook handler:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

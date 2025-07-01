import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import cors from "cors";

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

// Middleware to parse JSON bodies
app.use(express.json());

// === MongoDB connection setup ===
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://<username>:<password>@<cluster-url>/<dbname>?retryWrites=true&w=majority";
const DB_NAME = process.env.DB_NAME || "robocall_db";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "assistants";

let db, assistantsCollection, ticketsCollection;

/**
 * Connect to MongoDB once at startup
 * Also set up the tickets collection
 */
async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  assistantsCollection = db.collection(COLLECTION_NAME);
  ticketsCollection = db.collection("tickets");
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
app.post("/api/agent-id", async (req, res) => {
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
app.put("/api/agent-id/:slug", async (req, res) => {
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

app.post("/webhook/ticket", async (req, res) => {
  const { subject, description, priority, customer_name } = req.body;
  if (!subject) {
    return res.status(400).json({ error: "Missing required field: subject" });
  }
  try {
    const ticket_number = await generateTicketNumber();
    const ticket = {
      ticket_number,
      subject,
      description: description || "",
      priority: priority || "normal",
      customer_name: customer_name || "",
      created_at: new Date()
    };
    const result = await ticketsCollection.insertOne(ticket);
    res.status(201).json({ message: "Ticket created", ticket_number, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

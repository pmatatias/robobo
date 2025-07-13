# API Endpoints Curl Examples

This document provides `curl` command examples for interacting with the Robocall Assistant API.
Assume the server is running on `https://robobo-production.up.railway.app`.

---

## 9. POST /webhook/ticket/update-status
**Summary**: Update ticket status.
**Required Body**: `ticket_number`, `status`

**Example**: Update status for ticket `ABCDEF` to `closed`
```bash
curl -X POST "https://robobo-production.up.railway.app/webhook/ticket/update-status" \
-H "Content-Type: application/json" \
-d '{
  "ticket_number": "ABCDEF",
  "status": "closed",
  "agent_id": "agent_123"
}'
```

---

## 11. POST /webhook/robocall-ticket/update-status
**Summary**: Updates ticket_status for a robocall ticket.
**Required Body**: `ticket_number`, `ticket_status`

**Example**: Update robocall ticket status for `XYZ123` to `resolved`
```bash
curl -X POST "https://robobo-production.up.railway.app/webhook/robocall-ticket/update-status" \
-H "Content-Type: application/json" \
-d '{
  "ticket_number": "XYZ123",
  "ticket_status": "resolved",
  "agent_id": "agent_456"
}'
```

---

## 12. POST /webhook/robocall-ticket/status
**Summary**: Get robocall ticket status and subject.
**Required Body**: `ticket_number`

**Example**: Get status for robocall ticket `XYZ123`
```bash
curl -X POST "https://robobo-production.up.railway.app/webhook/robocall-ticket/status" \
-H "Content-Type: application/json" \
-d '{
  "ticket_number": "XYZ123"
}'
```

---

## 13. POST /webhook/robocall-ticket
**Summary**: Create a new robocall ticket.
**Required Body**: `subject`, `agent_id`, `conversation_id`

**Example**: Create a new robocall ticket
```bash
curl -X POST "https://robobo-production.up.railway.app/webhook/robocall-ticket" \
-H "Content-Type: application/json" \
-d '{
  "subject": "Robocall detected",
  "category": "Spam",
  "customer_name": "Unknown",
  "priority": "low",
  "agent_id": "robocall_agent_001",
  "conversation_id": "conv_robocall_123"
}'
```

---

## 14. GET /api/robocall-tickets
**Summary**: Returns all robocall tickets, or those matching `call_transcription.data.agent_id` or `ticket_number`.
**Optional Query Parameters**: `agent_id`, `ticket_number`

**Example 1**: Get all robocall tickets
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets"
```

**Example 2**: Filter robocall tickets by `agent_id`
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets?agent_id=robocall_agent_001"
```

**Example 3**: Filter robocall tickets by `ticket_number`
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets?ticket_number=XYZ123"
```

**Example 4**: Filter robocall tickets by both `agent_id` and `ticket_number`
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets?agent_id=robocall_agent_001&ticket_number=XYZ123"
```

---

## 15. POST /trigger_qa_robocall
**Summary**: Triggers a QA robocall evaluation with provided ticket JSON data.
**Required Body**: `_id` (MongoDB ObjectId), `ticket_number`, `customer_name`, `call_transcript`, `status`

**Example**: Trigger QA evaluation for a robocall ticket
```bash
curl -X POST "https://robobo-production.up.railway.app/trigger_qa_robocall" \
-H "Content-Type: application/json" \
-d '{
  "_id": { "$oid": "65c7e2f1a1b2c3d4e5f6a7b8" },
  "ticket_number": "TICKET-001",
  "customer_name": "John Doe",
  "call_transcript": {
    "data": {
      "transcript": [
        {"role": "agent", "message": "Hello."},
        {"role": "user", "message": "Is this a test?"}
      ]
    }
  },
  "status": "open"
}'
```

---

## 16. GET /api/robocall-tickets/pending-eval
**Summary**: Returns a page of tickets where `eval` is null, sorted by `_id` ascending.
**Optional Query Parameters**: `limit` (default 1000, max 1000)

**Example 1**: Get pending evaluations (default limit)
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets/pending-eval"
```

**Example 2**: Get pending evaluations with a limit of 50
```bash
curl -X GET "https://robobo-production.up.railway.app/api/robocall-tickets/pending-eval?limit=50"

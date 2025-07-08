## 1. Create a New Ticket

```bash
curl -X POST https://robobo-production.up.railway.app/webhook/ticket \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Cannot log in",
    "description": "User reports login failure.",
    "priority": "high",
    "customer_name": "John Doe",
    "agent_id": "agent123",
    "status": "open"
  }'
```

---

## 2. Get Ticket Status/Details

```bash
curl -X POST https://robobo-production.up.railway.app/webhook/ticket/status \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_number": "ABC123"
  }'
```
*Replace `"ABC123"` with the actual ticket number you want to query.*

---

## 3. Update Ticket Status

```bash
curl -X POST https://robobo-production.up.railway.app/webhook/ticket/update-status \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_number": "ABC123",
    "status": "closed",
    "agent_id": "agent123"
  }'
```
*Replace `"ABC123"` and `"agent123"` as needed. The `agent_id` is optional.*

---

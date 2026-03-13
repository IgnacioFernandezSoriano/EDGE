import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase client for token validation (server-side)
const supabaseUrl  = process.env.VITE_SUPABASE_URL  || "https://ewyhmmixqcubqokphebh.supabase.co";
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTc3MjMsImV4cCI6MjA4ODU3MzcyM30.xMtcrn12c9r0Q_Q0e46Ptsci7Y31YnB5V9MSBHgj20k";
const supabase = createClient(supabaseUrl, supabaseAnon);

// Path to the audit pipeline script
const AUDIT_PIPELINE = "/home/ubuntu/edge_analysis/run_audit_pipeline.py";

// Track running audit process to prevent concurrent executions
let auditRunning = false;

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // ── Middleware: validate admin token ──────────────────────────────────
  async function requireAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Token de autenticación requerido" });
      return;
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Token inválido o caducado" });
      return;
    }
    // Check admin role via user metadata or app_metadata
    const role = user.app_metadata?.role || user.user_metadata?.role;
    if (role !== "admin") {
      res.status(403).json({ error: "Acceso denegado: se requiere rol admin" });
      return;
    }
    next();
  }

  // ── GET /api/audit/status — estado del proceso ────────────────────────
  app.get("/api/audit/status", requireAdmin, (_req, res) => {
    res.json({ running: auditRunning });
  });

  // ── POST /api/audit/run — ejecutar pipeline con SSE streaming ─────────
  app.post("/api/audit/run", requireAdmin, (req, res) => {
    if (auditRunning) {
      res.status(409).json({ error: "El audit ya está en ejecución" });
      return;
    }

    // Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const send = (type: string, data: object) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    auditRunning = true;
    send("start", { message: "Iniciando Audit de Carga de Datos..." });

    const proc = spawn("python3.11", [AUDIT_PIPELINE], {
      cwd: "/home/ubuntu/edge_analysis",
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        send("log", { message: line });
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        send("error", { message: line });
      }
    });

    proc.on("close", (code: number | null) => {
      auditRunning = false;
      if (code === 0) {
        send("done", { success: true,  message: "Audit completado correctamente" });
      } else {
        send("done", { success: false, message: `Audit finalizado con código de error: ${code}` });
      }
      res.end();
    });

    proc.on("error", (err: Error) => {
      auditRunning = false;
      send("done", { success: false, message: `Error al iniciar el proceso: ${err.message}` });
      res.end();
    });

    // If client disconnects, kill the process
    req.on("close", () => {
      if (auditRunning) {
        proc.kill();
        auditRunning = false;
      }
    });
  });

  // ── Serve static frontend ─────────────────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);

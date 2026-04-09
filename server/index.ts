import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fs from "fs";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase clients ───────────────────────────────────────────────────────
// Anon key for audit pipeline (existing)
const supabaseUrl  = process.env.SUPABASE_URL!;
const supabaseAnon = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnon);

// Service role key for ETL RFID (needs write access)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// ── Script paths ───────────────────────────────────────────────────────────
const AUDIT_PIPELINE = "/home/ubuntu/edge_analysis/run_audit_pipeline.py";
const RFID_ETL_SCRIPT = path.resolve(__dirname, "..", "scripts", "process_rfid_etl.py");

// ── State tracking ─────────────────────────────────────────────────────────
let auditRunning = false;

interface EtlStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunMode: string | null;
  lastRunResult: "success" | "error" | null;
  lastRunDuration: number | null;
  lastRunLog: string[];
}
const etlStatus: EtlStatus = {
  running: false,
  lastRunAt: null,
  lastRunMode: null,
  lastRunResult: null,
  lastRunDuration: null,
  lastRunLog: [],
};

// ── Multer: CSV upload ─────────────────────────────────────────────────────
const UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    cb(null, `rfid_upload_${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos CSV"));
    }
  },
});

// ── ETL runner ─────────────────────────────────────────────────────────────
function runEtlProcess(mode: string, csvFilePath?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["--mode", mode];
    if (mode === "csv" && csvFilePath) args.push("--file", csvFilePath);

    const startTime = Date.now();
    etlStatus.running = true;
    etlStatus.lastRunAt = new Date().toISOString();
    etlStatus.lastRunMode = mode;
    etlStatus.lastRunLog = [];

    const proc = spawn("python3.11", [RFID_ETL_SCRIPT, ...args], {
      env: { ...process.env, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_KEY },
    });

    proc.stdout.on("data", (data: Buffer) => {
      data.toString().split("\n").filter(Boolean).forEach(line => {
        console.log(`[ETL] ${line}`);
        etlStatus.lastRunLog.push(line);
        if (etlStatus.lastRunLog.length > 500) etlStatus.lastRunLog.shift();
      });
    });

    proc.stderr.on("data", (data: Buffer) => {
      data.toString().split("\n").filter(Boolean).forEach(line => {
        console.error(`[ETL ERR] ${line}`);
        etlStatus.lastRunLog.push(`ERROR: ${line}`);
      });
    });

    proc.on("close", (code) => {
      etlStatus.running = false;
      etlStatus.lastRunDuration = (Date.now() - startTime) / 1000;
      if (csvFilePath && fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
      if (code === 0) {
        etlStatus.lastRunResult = "success";
        resolve();
      } else {
        etlStatus.lastRunResult = "error";
        reject(new Error(`ETL finalizado con código de error: ${code}`));
      }
    });

    proc.on("error", (err) => {
      etlStatus.running = false;
      etlStatus.lastRunResult = "error";
      reject(err);
    });
  });
}

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
    const role = user.app_metadata?.role || user.user_metadata?.role;
    if (role !== "admin") {
      res.status(403).json({ error: "Acceso denegado: se requiere rol admin" });
      return;
    }
    next();
  }

  // ── GET /api/audit/status — estado del audit pipeline (existing) ──────
  app.get("/api/audit/status", requireAdmin, (_req, res) => {
    res.json({ running: auditRunning });
  });

  // ── POST /api/audit/run — ejecutar audit pipeline con SSE (existing) ──
  app.post("/api/audit/run", requireAdmin, (req, res) => {
    if (auditRunning) {
      res.status(409).json({ error: "El audit ya está en ejecución" });
      return;
    }

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
      chunk.toString().split("\n").filter(Boolean).forEach(line => send("log", { message: line }));
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      chunk.toString().split("\n").filter(Boolean).forEach(line => send("error", { message: line }));
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

    req.on("close", () => {
      if (auditRunning) { proc.kill(); auditRunning = false; }
    });
  });

  // ── GET /api/etl/rfid/status — estado del ETL RFID ───────────────────
  app.get("/api/etl/rfid/status", requireAdmin, (_req, res) => {
    res.json(etlStatus);
  });

  // ── POST /api/etl/rfid/upload — subir CSV y ejecutar ETL ─────────────
  app.post(
    "/api/etl/rfid/upload",
    requireAdmin,
    upload.single("file"),
    async (req, res) => {
      if (etlStatus.running) {
        res.status(409).json({ error: "El ETL ya está en ejecución. Espera a que termine." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "No se ha proporcionado ningún archivo CSV" });
        return;
      }
      const csvPath = req.file.path;
      console.log(`[ETL] CSV recibido: ${csvPath} (${req.file.size} bytes)`);
      res.status(202).json({
        message: "ETL iniciado. Consulta /api/etl/rfid/status para seguir el progreso.",
        file: req.file.originalname,
        size: req.file.size,
      });
      runEtlProcess("csv", csvPath).catch(err => console.error(`[ETL] Error: ${err.message}`));
    }
  );

  // ── POST /api/etl/rfid/run — ejecutar ETL en modo backfill/incremental
  app.post("/api/etl/rfid/run", requireAdmin, async (req, res) => {
    if (etlStatus.running) {
      res.status(409).json({ error: "El ETL ya está en ejecución. Espera a que termine." });
      return;
    }
    const mode = (req.body?.mode as string) || "incremental";
    if (!["backfill", "incremental", "sync-only"].includes(mode)) {
      res.status(400).json({ error: `Modo no válido: ${mode}` });
      return;
    }
    res.status(202).json({
      message: `ETL iniciado en modo '${mode}'. Consulta /api/etl/rfid/status para seguir el progreso.`,
    });
    runEtlProcess(mode).catch(err => console.error(`[ETL] Error: ${err.message}`));
  });

  // ── Serve static frontend ─────────────────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);

import { config } from "dotenv";

// Tests never touch the dev database.
config({ path: ".env.local", quiet: true });
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is missing (see .env.example)");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DRIVER = "dev";

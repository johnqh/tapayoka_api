import { initDatabase } from "./index.ts";

// Run migrations as a standalone script
initDatabase()
  .then(() => {
    console.log("Migration complete");
    process.exit(0);
  })
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });

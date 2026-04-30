import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const memoryTable = pgTable("scarl_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  summary: text("summary").notNull(),
  primaryFocus: text("primary_focus"),
  spokenReply: text("spoken_reply"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type MemoryRow = typeof memoryTable.$inferSelect;
export type InsertMemoryRow = typeof memoryTable.$inferInsert;

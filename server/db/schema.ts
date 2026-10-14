import { integer, pgTable, varchar } from "drizzle-orm/pg-core";

// EXAMPLE OF A POSTGRES DRIZZLE TABLE DEFINITION
// NEEDS TO BE REMOVED BEFORE ACTUAL CODE PRODUCTION OR DEV CODE, JUST FOR DEMO SO DELETE
export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  age: integer().notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
});

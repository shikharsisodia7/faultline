/**
 * Collection schemas: single source of truth for worker and frontend.
 * Faultline's own collections and their access model live in
 * src/schemas/faultline-schemas.ts (see docs/DATA-MODEL.md).
 */
import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { faultlineSchemas } from './schemas/faultline-schemas'

export const schemas: CollectionSchema[] = [usersSchema, ...faultlineSchemas]

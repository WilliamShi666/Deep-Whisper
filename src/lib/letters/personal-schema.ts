import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { visitors, companions, conversations } from '@/storage/database/shared/schema';

/** Personal letter tables. Migration 0003 is the reviewed SQL counterpart. */
export const letterPreferences=sqliteTable('letter_preferences',{
 visitorId:text('visitor_id').primaryKey().references(()=>visitors.id,{onDelete:'cascade'}),
 inAppEnabled:integer('in_app_enabled',{mode:'boolean'}).notNull().default(false),
 emailEnabled:integer('email_enabled',{mode:'boolean'}).notNull().default(false),
 emailAddress:text('email_address'),
 emailStatus:text('email_status',{enum:['enabled','paused','unsubscribed','suppressed']}).notNull().default('paused'),
 timezone:text('timezone').notNull().default('Asia/Shanghai'),
 windowStartedAt:integer('window_started_at'),lastInteractionAt:integer('last_interaction_at'),updatedAt:integer('updated_at').notNull(),
},table=>[check('letter_preferences_in_app',sql`${table.inAppEnabled} IN (0,1)`),check('letter_preferences_email',sql`${table.emailEnabled} IN (0,1)`),check('letter_preferences_email_status',sql`${table.emailStatus} IN ('enabled','paused','unsubscribed','suppressed')`)]);
export const letterJobs=sqliteTable('letter_jobs',{
 id:text('id').primaryKey(),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),
 companionId:text('companion_id').notNull().references(()=>companions.id,{onDelete:'cascade'}),conversationId:text('conversation_id').notNull().references(()=>conversations.id,{onDelete:'cascade'}),
 localDate:text('local_date').notNull(),triggerKey:text('trigger_key').notNull(),payload:text('payload').notNull(),
 status:text('status',{enum:['pending','running','done','failed','cancelled']}).notNull().default('pending'),attempts:integer('attempts').notNull().default(0),availableAt:integer('available_at').notNull(),
 leaseToken:text('lease_token'),leaseExpiresAt:integer('lease_expires_at'),lastError:text('last_error'),createdAt:integer('created_at').notNull(),
},table=>[uniqueIndex('letter_jobs_owner_date').on(table.visitorId,table.localDate),uniqueIndex('letter_jobs_owner_trigger').on(table.visitorId,table.triggerKey),check('letter_jobs_json',sql`json_valid(${table.payload})`),check('letter_jobs_status',sql`${table.status} IN ('pending','running','done','failed','cancelled')`)]);
export const letters=sqliteTable('letters',{
 id:text('id').primaryKey(),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),
 companionId:text('companion_id').notNull().references(()=>companions.id,{onDelete:'cascade'}),conversationId:text('conversation_id').references(()=>conversations.id,{onDelete:'set null'}),
 companionName:text('companion_name').notNull(),subject:text('subject').notNull(),body:text('body').notNull(),kind:text('kind',{enum:['L0','L1','L2']}).notNull(),
 localDate:text('local_date').notNull(),triggerKey:text('trigger_key').notNull(),createdAt:integer('created_at').notNull(),readAt:integer('read_at'),
},table=>[uniqueIndex('letters_owner_date').on(table.visitorId,table.localDate),uniqueIndex('letters_owner_trigger').on(table.visitorId,table.triggerKey),index('letters_owner_created').on(table.visitorId,table.createdAt),check('letters_kind',sql`${table.kind} IN ('L0','L1','L2')`)]);
export const letterOutbox=sqliteTable('letter_outbox',{
 id:text('id').primaryKey(),letterId:text('letter_id').notNull().unique().references(()=>letters.id,{onDelete:'cascade'}),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),
 recipient:text('recipient').notNull(),provider:text('provider',{enum:['smtp','resend']}).notNull(),
 status:text('status',{enum:['pending','sending','accepted','delivered','bounced','complained','failed','unknown','cancelled']}).notNull().default('pending'),
 attempts:integer('attempts').notNull().default(0),availableAt:integer('available_at').notNull(),leaseToken:text('lease_token'),leaseExpiresAt:integer('lease_expires_at'),providerMessageId:text('provider_message_id'),lastError:text('last_error'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},table=>[uniqueIndex('letter_outbox_provider_message').on(table.provider,table.providerMessageId).where(sql`${table.providerMessageId} IS NOT NULL`),check('letter_outbox_provider',sql`${table.provider} IN ('smtp','resend')`),check('letter_outbox_status',sql`${table.status} IN ('pending','sending','accepted','delivered','bounced','complained','failed','unknown','cancelled')`)]);
export const letterWebhookEvents=sqliteTable('letter_webhook_events',{
 id:text('id').primaryKey(),providerMessageId:text('provider_message_id').notNull(),eventType:text('event_type',{enum:['delivered','bounced','complained']}).notNull(),createdAt:integer('created_at').notNull(),processedAt:integer('processed_at'),
},table=>[check('letter_webhook_events_type',sql`${table.eventType} IN ('delivered','bounced','complained')`)]);

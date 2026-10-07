import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, check, index, foreignKey } from 'drizzle-orm/sqlite-core';
const id = () => text('id').primaryKey().$defaultFn(randomUUID);
const times = () => ({createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull()});
export const visitors=sqliteTable('visitors',{
  id:id(),ownerSlot:integer('owner_slot').notNull().default(1),gender:text('gender'),orientation:text('orientation'),nickname:text('nickname'),themeId:text('theme_id'),uiTheme:text('ui_theme'),palette:text('palette'),locale:text('locale'),...times(),
},t=>[uniqueIndex('one_owner').on(t.ownerSlot),check('owner_slot_one',sql`${t.ownerSlot}=1`),check('visitor_palette',sql`${t.palette} IS NULL OR ${t.palette} IN ('rose','blue')`),check('visitor_locale',sql`${t.locale} IS NULL OR ${t.locale} IN ('zh-CN','en')`)]);
export const companions=sqliteTable('companions',{
  id:id(),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),characterKey:text('character_key').notNull(),name:text('name').notNull(),persona:text('persona'),occupation:text('occupation'),userTitle:text('user_title'),voiceId:text('voice_id'),appearanceStyle:text('appearance_style').notNull(),themeId:text('theme_id'),...times(),
},t=>[uniqueIndex('companion_owner').on(t.id,t.visitorId),index('companions_owner_idx').on(t.visitorId),check('appearance_style_valid',sql`${t.appearanceStyle} IN ('chibi','normal')`),check('persona_length',sql`${t.persona} IS NULL OR length(${t.persona})<=600`)]);
export const conversations=sqliteTable('conversations',{
  id:id(),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),companionId:text('companion_id').notNull(),title:text('title'),...times(),
},t=>[foreignKey({columns:[t.companionId,t.visitorId],foreignColumns:[companions.id,companions.visitorId]}).onDelete('cascade'),index('conversation_owner_updated_idx').on(t.visitorId,t.updatedAt),check('title_length',sql`${t.title} IS NULL OR length(${t.title})<=128`)]);
export const messages=sqliteTable('messages',{
  id:id(),conversationId:text('conversation_id').notNull().references(()=>conversations.id,{onDelete:'cascade'}),role:text('role').notNull(),contentType:text('content_type').notNull().default('text'),content:text('content'),imageUrl:text('image_url'),audioUrl:text('audio_url'),createdAt:integer('created_at').notNull(),
},t=>[index('messages_conversation_time_idx').on(t.conversationId,t.createdAt),check('message_role',sql`${t.role} IN ('user','assistant')`),check('message_type',sql`${t.contentType} IN ('text','image','photo_pending','photo_failed')`)]);
export const userProfiles=sqliteTable('user_profiles',{
  id:id(),visitorId:text('visitor_id').notNull().unique().references(()=>visitors.id,{onDelete:'cascade'}),displayName:text('display_name'),birthday:text('birthday'),occupation:text('occupation'),city:text('city'),timezone:text('timezone'),familyMembers:text('family_members').notNull().default('[]'),importantDates:text('important_dates').notNull().default('[]'),lifestyle:text('lifestyle').notNull().default('{}'),communicationPrefs:text('communication_prefs').notNull().default('{}'),...times(),
},t=>[check('profile_family_json',sql`json_valid(${t.familyMembers}) AND json_type(${t.familyMembers})='array'`),check('profile_dates_json',sql`json_valid(${t.importantDates}) AND json_type(${t.importantDates})='array'`),check('profile_lifestyle_json',sql`json_valid(${t.lifestyle}) AND json_type(${t.lifestyle})='object'`),check('profile_prefs_json',sql`json_valid(${t.communicationPrefs}) AND json_type(${t.communicationPrefs})='object'`)]);
export const relationshipSnapshots=sqliteTable('relationship_snapshots',{
  id:id(),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),companionId:text('companion_id').notNull(),relationshipStage:text('relationship_stage'),emotionalTone:text('emotional_tone'),dynamicSummary:text('dynamic_summary'),keyMilestones:text('key_milestones').notNull().default('[]'),observedAt:integer('observed_at'),...times(),
},t=>[uniqueIndex('relationship_scope').on(t.visitorId,t.companionId),foreignKey({columns:[t.companionId,t.visitorId],foreignColumns:[companions.id,companions.visitorId]}).onDelete('cascade'),check('relationship_milestones_json',sql`json_valid(${t.keyMilestones}) AND json_type(${t.keyMilestones})='array'`)]);
export const messageFeedback=sqliteTable('message_feedback',{
  id:id(),messageId:text('message_id').notNull().references(()=>messages.id,{onDelete:'cascade'}),visitorId:text('visitor_id').notNull().references(()=>visitors.id,{onDelete:'cascade'}),conversationId:text('conversation_id').notNull().references(()=>conversations.id,{onDelete:'cascade'}),companionId:text('companion_id').notNull().references(()=>companions.id,{onDelete:'cascade'}),rating:integer('rating').notNull(),comment:text('comment'),...times(),
},t=>[uniqueIndex('feedback_message_owner').on(t.messageId,t.visitorId),check('feedback_rating',sql`${t.rating} IN (-1,1)`),check('feedback_comment',sql`${t.comment} IS NULL OR length(${t.comment})<=500`)]);
export const operationLeases=sqliteTable('operation_leases',{
  resourceKey:text('resource_key').primaryKey(),token:text('token').notNull(),expiresAt:integer('expires_at').notNull(),
});

import { relations } from "drizzle-orm/relations";
import { visitors, conversations, companions, messages, userProfiles, relationshipSnapshots } from "./schema";

export const conversationsRelations = relations(conversations, ({one, many}) => ({
	visitor: one(visitors, {
		fields: [conversations.visitorId],
		references: [visitors.id]
	}),
	companion: one(companions, {
		fields: [conversations.companionId],
		references: [companions.id]
	}),
	messages: many(messages),
}));

export const visitorsRelations = relations(visitors, ({many}) => ({
	conversations: many(conversations),
	companions: many(companions),
	userProfiles: many(userProfiles),
	relationshipSnapshots: many(relationshipSnapshots),
}));

export const companionsRelations = relations(companions, ({one, many}) => ({
	conversations: many(conversations),
	visitor: one(visitors, {
		fields: [companions.visitorId],
		references: [visitors.id]
	}),
	relationshipSnapshots: many(relationshipSnapshots),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
}));

export const userProfilesRelations = relations(userProfiles, ({one}) => ({
	visitor: one(visitors, {
		fields: [userProfiles.visitorId],
		references: [visitors.id]
	}),
}));

export const relationshipSnapshotsRelations = relations(relationshipSnapshots, ({one}) => ({
	visitor: one(visitors, {
		fields: [relationshipSnapshots.visitorId],
		references: [visitors.id]
	}),
	companion: one(companions, {
		fields: [relationshipSnapshots.companionId],
		references: [companions.id]
	}),
}));
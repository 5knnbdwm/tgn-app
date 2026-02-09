import {
  createClient,
  type GenericCtx,
  type AuthFunctions,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { query } from "./_generated/server";

import type { DataModel } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;
const convexSiteUrl = process.env.CONVEX_SITE_URL!;

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        const existingUser = await ctx.db.query("users").first();
        if (existingUser) {
          const identity = await ctx.auth.getUserIdentity();
          if (!identity) {
            throw new Error("Only admins can create users");
          }

          const actor = await ctx.db
            .query("users")
            .withIndex("by_auth_id", (q) => q.eq("authId", identity.subject))
            .first();
          if (!actor || actor.role !== "admin") {
            throw new Error("Only admins can create users");
          }
        }

        const now = Date.now();
        await ctx.db.insert("users", {
          authId: doc._id,
          displayName: doc.name,
          email: doc.email,
          role: existingUser ? "member" : "admin",
          createdAt: now,
          updatedAt: now,
        });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        const nameChanged = newDoc.name !== oldDoc.name;
        const emailChanged = newDoc.email !== oldDoc.email;
        const imageChanged = newDoc.image !== oldDoc.image;
        if (nameChanged || emailChanged || imageChanged) {
          const user = await ctx.db
            .query("users")
            .withIndex("by_auth_id", (q) => q.eq("authId", newDoc._id))
            .first();
          if (user) {
            await ctx.db.patch(user._id, {
              ...(nameChanged && { displayName: newDoc.name }),
              ...(emailChanged && { email: newDoc.email }),
              ...(imageChanged && { avatarUrl: newDoc.image ?? undefined }),
              updatedAt: Date.now(),
            });
          }
        }
      },
      onDelete: async (ctx, doc) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_auth_id", (q) => q.eq("authId", doc._id))
          .first();
        if (user) {
          await ctx.db.delete(user._id);
        }
      },
    },
  },
});

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: convexSiteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true },
    plugins: [convex({ authConfig })],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: [siteUrl],
  });
};

export const getPermissionContext = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_id", (q) => q.eq("authId", identity.subject))
      .first();

    if (!user) return null;

    return {
      role: user.role,
      userId: user.authId,
    };
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

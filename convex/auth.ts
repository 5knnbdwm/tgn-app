import {
  createClient,
  type GenericCtx,
  type AuthFunctions,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

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
    databaseHooks: {
      user: {
        create: {
          before: async (user, authCtx) => {
            const existingUser = await ctx.runQuery(
              internal.auth.hasAnyUserForSignUpGate,
            );
            if (!existingUser) {
              return {
                data: {
                  ...user,
                  role: "admin",
                },
              };
            }

            const actorAuthId = authCtx?.context.session?.user?.id;
            if (!actorAuthId) {
              throw new APIError("FORBIDDEN", {
                message: "Only admins can create users",
              });
            }

            const actorRole = await ctx.runQuery(
              internal.auth.getUserRoleByAuthIdForSignUpGate,
              { authId: actorAuthId },
            );
            if (actorRole !== "admin") {
              throw new APIError("FORBIDDEN", {
                message: "Only admins can create users",
              });
            }

            return {
              data: {
                ...user,
                role: user.role === "admin" ? "admin" : "user",
              },
            };
          },
        },
      },
    },
    plugins: [convex({ authConfig }), admin()],
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

export const hasAnyUserForSignUpGate = internalQuery({
  handler: async (ctx) => {
    const existingUser = await ctx.db.query("users").first();
    return !!existingUser;
  },
});

export const getUserRoleByAuthIdForSignUpGate = internalQuery({
  args: {
    authId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_id", (q) => q.eq("authId", args.authId))
      .first();
    return user?.role ?? null;
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authorize } from "./lib/permissions";

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);

export const listUsers = query({
  handler: async (ctx) => {
    await authorize(ctx, "user.read");

    const users = await ctx.db.query("users").order("desc").collect();

    return users.map((user) => ({
      _id: user._id,
      authId: user.authId,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));
  },
});

export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const actor = await authorize(ctx, "user.role.update");

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new Error("User not found");
    }

    if (target.role === args.role) {
      return target;
    }

    if (target.role === "admin" && args.role !== "admin") {
      const admins = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect();

      if (admins.length <= 1) {
        throw new Error("At least one admin is required");
      }

      if (target.authId === actor.authId) {
        throw new Error("You cannot remove your own admin role");
      }
    }

    await ctx.db.patch(target._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return {
      ...target,
      role: args.role,
      updatedAt: Date.now(),
    };
  },
});

export const setUserRoleByAuthId = mutation({
  args: {
    authId: v.string(),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "user.create");

    const target = await ctx.db
      .query("users")
      .withIndex("by_auth_id", (q) => q.eq("authId", args.authId))
      .first();

    if (!target) {
      throw new Error("User not found");
    }

    await ctx.db.patch(target._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return {
      ...target,
      role: args.role,
      updatedAt: Date.now(),
    };
  },
});

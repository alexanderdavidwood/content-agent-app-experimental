import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  approvedChangeSchema,
  applyResultSchema,
  candidateEntrySnapshotSchema,
  renameRunInputSchema,
} from "@contentful-rename/shared";
import { z } from "zod";

import { buildDiscoveryPlan, buildProposedChanges } from "../lib/renameEngine";
import { runStore } from "../lib/runStore";

const createRunBodySchema = renameRunInputSchema;

const proposalBodySchema = z.object({
  input: renameRunInputSchema,
  candidates: z.array(candidateEntrySnapshotSchema),
});

const approvalBodySchema = z.object({
  approvals: z.array(approvedChangeSchema),
});

const reportBodySchema = z.object({
  input: renameRunInputSchema,
  results: z.array(applyResultSchema),
});

export const workflowRoute = new Hono()
  .post("/runs", async (c) => {
    const input = createRunBodySchema.parse(await c.req.json());
    const discoveryPlan = await buildDiscoveryPlan(input);
    const runId = randomUUID();
    const timestamp = new Date().toISOString();

    await runStore.upsert({
      runId,
      createdAt: timestamp,
      updatedAt: timestamp,
      input,
      discoveryPlan,
      candidates: [],
      proposedChanges: [],
      approvals: [],
      results: [],
      status: "discovered",
    });

    return c.json({
      runId,
      discoveryPlan,
    });
  })
  .post("/runs/:runId/proposals", async (c) => {
    const runId = c.req.param("runId");
    const body = proposalBodySchema.parse(await c.req.json());
    const record = await runStore.get(runId);

    if (!record) {
      return c.json({ error: "Run not found" }, 404);
    }

    const proposedChanges = await buildProposedChanges(
      body.input,
      body.candidates,
    );

    const updated = await runStore.upsert({
      ...record,
      updatedAt: new Date().toISOString(),
      candidates: body.candidates,
      proposedChanges,
      status: "awaiting-approval",
    });

    return c.json({
      runId,
      status: updated.status,
      proposedChanges,
    });
  })
  .post("/runs/:runId/approve", async (c) => {
    const runId = c.req.param("runId");
    const body = approvalBodySchema.parse(await c.req.json());
    const record = await runStore.get(runId);

    if (!record) {
      return c.json({ error: "Run not found" }, 404);
    }

    const updated = await runStore.upsert({
      ...record,
      updatedAt: new Date().toISOString(),
      approvals: body.approvals,
      status: "approved",
    });

    return c.json({
      runId,
      status: updated.status,
      proposedChanges: updated.proposedChanges,
      approvals: updated.approvals,
    });
  })
  .post("/runs/:runId/report", async (c) => {
    const runId = c.req.param("runId");
    const body = reportBodySchema.parse(await c.req.json());
    const record = await runStore.get(runId);

    if (!record) {
      return c.json({ error: "Run not found" }, 404);
    }

    const updated = await runStore.upsert({
      ...record,
      input: body.input,
      updatedAt: new Date().toISOString(),
      results: body.results,
      status: "completed",
    });

    return c.json({
      runId,
      status: updated.status,
      resultCount: updated.results.length,
    });
  });

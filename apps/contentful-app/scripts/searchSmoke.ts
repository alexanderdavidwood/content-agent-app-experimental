import process from "node:process";

import semanticEnsureIndex from "../functions/semantic.ensureIndex";
import semanticSearch from "../functions/semantic.search";

const DEFAULT_QUERY = "porter";
const DEFAULT_LOCALE = process.env.CONTENTFUL_LOCALE?.trim() || "en-US";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function logResult(
  mode: "semantic" | "keyword" | "hybrid",
  result: Awaited<ReturnType<typeof semanticSearch>>,
) {
  console.log(`\n[${mode}] entryIds=${result.entryIds.length}`);
  for (const hit of result.queryHits) {
    console.log(`- query="${hit.query}" ids=${hit.entryIds.join(", ") || "(none)"}`);
    if (hit.warning) {
      console.log(`  warning=${hit.warning}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`warnings=${result.warnings.join(" | ")}`);
  }
}

async function main() {
  requireEnv("CONTENTFUL_ACCESS_TOKEN");
  requireEnv("CONTENTFUL_ORG_ID");
  requireEnv("CONTENTFUL_SPACE_ID");

  const query = process.env.SEARCH_SMOKE_QUERY?.trim() || DEFAULT_QUERY;
  const locale = DEFAULT_LOCALE;
  const context = {
    env: process.env as Record<string, string | undefined>,
  };

  let indexStatus:
    | Awaited<ReturnType<typeof semanticEnsureIndex>>
    | {
        status: "CHECK_FAILED";
        locale: string;
        warning: string;
      };

  try {
    indexStatus = await semanticEnsureIndex(
      {
        body: {
          locale,
          createIfMissing: false,
        },
      },
      context,
    );
  } catch (error) {
    indexStatus = {
      status: "CHECK_FAILED",
      locale,
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  console.log(
    `Semantic index status: ${indexStatus.status} locale=${indexStatus.locale}${
      indexStatus.warning ? ` warning=${indexStatus.warning}` : ""
    }`,
  );

  const keywordResult = await semanticSearch(
    {
      body: {
        mode: "keyword",
        queries: [query],
        limitPerQuery: 10,
      },
    },
    context,
  );
  logResult("keyword", keywordResult);
  if (keywordResult.entryIds.length === 0) {
    throw new Error(`Keyword search returned no entries for "${query}"`);
  }

  const hybridResult = await semanticSearch(
    {
      body: {
        mode: "hybrid",
        queries: [query],
        limitPerQuery: 10,
      },
    },
    context,
  );
  logResult("hybrid", hybridResult);
  if (hybridResult.entryIds.length === 0) {
    throw new Error(`Hybrid search returned no entries for "${query}"`);
  }

  try {
    const semanticResult = await semanticSearch(
      {
        body: {
          mode: "semantic",
          queries: [query],
          limitPerQuery: 10,
        },
      },
      context,
    );
    logResult("semantic", semanticResult);

    if (indexStatus.status === "ACTIVE" && semanticResult.entryIds.length === 0) {
      throw new Error(
        `Semantic search returned no entries for "${query}" with an ACTIVE index`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\n[semantic] failed: ${message}`);

    if (indexStatus.status === "ACTIVE") {
      throw error;
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

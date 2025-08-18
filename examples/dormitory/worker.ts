import {
  Controller,
  MonoSystem,
  CloudflareD1DB,
  USER_ENTITY,
  EventUser,
  EventPayload,
  EventQuery,
  MatchExp,
  InteractionEventArgs,
  asyncInteractionContext,
  assert,
} from "interaqt";
import { entities, relations, interactions } from "./backend/index.js";

export type APIBody = {
  activity?: string;
  activityId?: string;
  interaction?: string;
  payload?: EventPayload;
  query?: EventQuery;
};

export type DataAPIContext = { user: EventUser | null };

export type DataAPIHandle = (
  this: Controller,
  context: DataAPIContext,
  ...rest: any[]
) => any;

export type DataAPIConfig = {
  params?: any[] | {};
  useNamedParams?: boolean;
  allowAnonymous?: boolean;
};

export type DataAPI = DataAPIHandle & DataAPIConfig;

export type DataAPIs = {
  [k: string]: DataAPI;
};

const dataAPIs: DataAPIs = {};

type DataAPIClassParam<T extends any> = T & { fromValue: (value: any) => T };

function parseDataAPIParams(
  inputParams: DataAPIConfig["params"],
  api: DataAPI
): DataAPIConfig["params"] {
  if (!api.params) {
    return inputParams;
  }

  if (api.useNamedParams) {
    const params = api.params as { [k: string]: any };
    const objectParams = inputParams as { [k: string]: any };

    return Object.fromEntries(
      Object.entries(objectParams).map(([key, inputParam]) => {
        const param = params[key];

        if (param === undefined) return [key, inputParam];

        if (
          typeof param === "string" ||
          inputParam === undefined ||
          inputParam === null
        ) {
          return [key, inputParam];
        } else if (typeof param === "function") {
          if (!(param as DataAPIClassParam<any>).fromValue) {
            throw new Error("Invalid Class param type, missing fromValue");
          }
          return [key, (param as DataAPIClassParam<any>).fromValue(inputParam)];
        } else {
          throw new Error("Invalid param type");
        }
      })
    );
  } else {
    const params = api.params as any[];
    const arrayParams = inputParams as any[];
    return arrayParams.map((inputParam, index) => {
      const param = params[index];
      if (param === undefined) return inputParam;

      if (
        typeof param === "string" ||
        inputParam === undefined ||
        inputParam === null
      ) {
        return inputParam;
      } else if (typeof param === "function") {
        if (!(param as DataAPIClassParam<any>).fromValue) {
          throw new Error("Invalid Class param type, missing fromValue");
        }
        return (param as DataAPIClassParam<any>).fromValue(inputParam);
      } else {
        throw new Error("Invalid param type");
      }
    });
  }
}

export function createDataAPI(
  handle: DataAPIHandle,
  config: DataAPIConfig = {}
): DataAPI {
  assert(
    !(handle as DataAPI).params,
    `handle seems to be already an API`
  );
  const { params, allowAnonymous = false, useNamedParams = false } = config;

  if (!useNamedParams) {
    const arrayParams = (params || []) as any[];
    assert(
      handle.length < (arrayParams.length || 0) + 2,
      `Invalid params length, handle length: ${handle.length}, params length: ${arrayParams.length}`
    );
  }

  const api = handle as DataAPI;
  api.params = params;
  api.allowAnonymous = allowAnonymous;
  api.useNamedParams = useNamedParams;
  return api;
}

export function registerAPI(name: string, api: DataAPI) {
  dataAPIs[name] = api;
}

async function createController(env: { DB: any }) {
  const db = new CloudflareD1DB(env.DB);
  const controller = new Controller({
    system: new MonoSystem(db),
    entities,
    relations,
    activities: [],
    interactions,
    dict: [],
    recordMutationSideEffects: [],
  });
  await controller.setup(await db.checkSchemaVersionUpdate());
  return controller;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-user-id",
};

function withLogContext(
  asyncHandle: (request: Request, controller: Controller) => Promise<any>
) {
  return async (request: Request, controller: Controller) => {
    const logContext = {
      reqId: crypto.randomUUID(),
    };
    let result: any;
    await asyncInteractionContext.run(logContext, async () => {
      result = await asyncHandle(request, controller);
    });
    return result;
  };
}

export default {
  async fetch(request: Request, env: { DB: any }): Promise<Response> {
    const { pathname } = new URL(request.url);
    const { method, headers } = request;

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      const controller = await createController(env);

      if (pathname === "/api/health" && method === "GET") {
        return Response.json({ message: "ok" }, { headers: CORS });
      }

      // Interaction 处理
      if (pathname === "/api/interaction" && method === "POST") {
        const handler = withLogContext(async (request, controller) => {
          const body = (await request.json()) as APIBody;
          const {
            activity: activityName,
            activityId,
            interaction: interactionName,
            payload,
            query,
          } = body;

          // JWT 鉴权，获取用户身份
          const userId = headers.get("x-user-id");
          if (!userId) {
            throw { statusCode: 401, message: "Unauthorized" };
          }

          const user = await controller.system.storage.findOne(
            USER_ENTITY,
            MatchExp.atom({ key: "id", value: ["=", userId] }),
            undefined,
            ["*"]
          );
          if (!user) {
            throw { statusCode: 500, message: "User not synced" };
          }

          const eventArgs: InteractionEventArgs = {
            user,
            payload,
            query,
          };

          let result: any;
          if (activityName) {
            // Activity interaction 调用
            const activityCallId = controller.activityManager.activityCallsByName
              .get(activityName)
              ?.activity.uuid;
            const interactionId = controller.activityManager.activityCallsByName
              .get(activityName)!
              .interactionCallByName.get(interactionName!)?.interaction.uuid;
            result = await controller.activityManager.callActivityInteraction(
              activityCallId!,
              interactionId!,
              activityId,
              eventArgs
            );
          } else {
            // 普通 interaction 调用
            const interactionId = controller.activityManager.interactionCallsByName
              .get(interactionName!)
              ?.interaction.uuid;
            result = await controller.callInteraction(interactionId!, eventArgs);
          }

          // 统一处理 result，如果有 error，也要记录
          if (result.error) {
            throw { statusCode: 400, body: result };
          }

          return result;
        });

        const result = await handler(request, controller);
        return Response.json(result, { headers: CORS });
      }

      // Data API 处理
      if (pathname.startsWith("/api/") && method === "POST") {
        const apiName = pathname.replace("/api/", "");
        const api = dataAPIs[apiName];

        if (!api) {
          throw { statusCode: 404, message: `api ${apiName} not found` };
        }

        const handler = withLogContext(async (request, controller) => {
          let user = null;
          if (!api.allowAnonymous) {
            // JWT 鉴权，获取用户身份
            const userId = headers.get("x-user-id");
            if (!userId) {
              throw { statusCode: 401, message: "Unauthorized" };
            }

            user = await controller.system.storage.findOne(
              USER_ENTITY,
              MatchExp.atom({ key: "id", value: ["=", userId] }),
              undefined,
              ["*"]
            );

            if (!user) {
              throw { statusCode: 500, message: "User not synced" };
            }
          }

          // 参数处理
          const body = (await request.json()) as DataAPIConfig["params"];
          const apiParams = parseDataAPIParams(body, api);

          let result: any;
          if (api.useNamedParams) {
            result = await api.call(
              controller,
              { user: user as EventUser },
              apiParams
            );
          } else {
            result = await api.call(
              controller,
              { user: user as EventUser },
              ...(apiParams as any[])
            );
          }

          return result;
        });

        const result = await handler(request, controller);
        return Response.json(result, { headers: CORS });
      }

      throw { statusCode: 404, message: "Not Found" };
    } catch (e: any) {
      return Response.json(
        e.body || { error: e.message || "Internal Server Error" },
        { status: e.statusCode || 500, headers: CORS }
      );
    }
  },
};

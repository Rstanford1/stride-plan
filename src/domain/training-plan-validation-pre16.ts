import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020";
import schema from "../../schemas/training-plan/1.1.schema.json";
import type {
  TrainingPlan,
  ExerciseBlock,
  Quantity,
} from "../../.generated/training-plan";
import type {
  PlanDiagnostic,
  PlanValidationResult,
} from "./training-plan-contract";

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  ownProperties: true,
});
const validateStructure = ajv.compile<TrainingPlan>(schema);
type JsonObject = Record<string, unknown>;
type SchemaNode = {
  $ref?: string;
  title?: string;
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
};
const definitions = schema.$defs as unknown as Record<string, SchemaNode>;
const branchValidators = new WeakMap<SchemaNode, ValidateFunction>();
const pointerPart = (key: string) =>
  key.replace(/~/g, "~0").replace(/\//g, "~1");
const child = (path: string, key: string | number) =>
  `${path}/${pointerPart(String(key))}`;
const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (value: object, key: string) => Object.hasOwn(value, key);

function pointerParts(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer))
    return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolves(document: unknown, pointer: string): boolean {
  const parts = pointerParts(pointer);
  if (!parts) return false;
  let value: unknown = document;
  for (const part of parts) {
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(part) || !has(value, part)) return false;
      value = value[Number(part)];
    } else if (isObject(value) && has(value, part)) value = value[part];
    else return false;
  }
  return true;
}

function calendarDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return undefined;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    return undefined;
  return time / 86400000;
}

function structureDiagnostics(errors: ErrorObject[]): PlanDiagnostic[] {
  return errors.map((error) => ({
    severity: "error",
    code: `schema.${error.keyword}`,
    path:
      error.keyword === "required"
        ? child(error.instancePath, String(error.params.missingProperty))
        : error.instancePath,
    message: error.message ?? "Invalid plan structure.",
  }));
}

/** Accept JSON values only, with bounded traversal before Ajv touches input. */
function inspectJson(value: unknown): PlanDiagnostic[] {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (
    item: unknown,
    path: string,
    depth: number,
  ): PlanDiagnostic | undefined => {
    if (++nodes > 200000 || depth > 64)
      return {
        severity: "error",
        code: "input_limit",
        path,
        message: "Plan exceeds the 200,000-value or 64-level input limit.",
      };
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || item === null)
      return {
        severity: "error",
        code: "not_json",
        path,
        message: "Expected a finite JSON value.",
      };
    if (ancestors.has(item))
      return {
        severity: "error",
        code: "not_json",
        path,
        message: "JSON cannot contain circular references.",
      };
    const prototype = Object.getPrototypeOf(item);
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      return {
        severity: "error",
        code: "not_json",
        path,
        message: "Expected a plain JSON object.",
      };
    ancestors.add(item);
    if (Object.getOwnPropertySymbols(item).length)
      return {
        severity: "error",
        code: "not_json",
        path,
        message: "JSON cannot contain symbol keys.",
      };
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(item),
    )) {
      if (Array.isArray(item) && key === "length") continue;
      if (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key))
        return {
          severity: "error",
          code: "not_json",
          path: child(path, key),
          message: "JSON arrays cannot have named properties.",
        };
      if (!descriptor.enumerable || !("value" in descriptor))
        return {
          severity: "error",
          code: "not_json",
          path: child(path, key),
          message: "JSON properties must be enumerable data values.",
        };
      const failure = visit(descriptor.value, child(path, key), depth + 1);
      if (failure) return failure;
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length)
      return {
        severity: "error",
        code: "not_json",
        path,
        message: "Sparse arrays are not supported.",
      };
    ancestors.delete(item);
  };
  const failure = visit(value, "", 0);
  return failure ? [failure] : [];
}

function resolveSchema(node: SchemaNode, value: unknown): SchemaNode {
  if (node.$ref)
    return resolveSchema(definitions[node.$ref.split("/").at(-1)!], value);
  const alternatives = node.oneOf ?? node.anyOf;
  if (alternatives) {
    const branch = alternatives.find((candidate) => {
      let validate = branchValidators.get(candidate);
      if (!validate) {
        validate = ajv.compile({ ...candidate, $defs: schema.$defs });
        branchValidators.set(candidate, validate);
      }
      return validate(value);
    });
    if (branch) return resolveSchema(branch, value);
  }
  return node;
}

export function validateTrainingPlan(value: unknown): PlanValidationResult {
  const diagnostics = inspectJson(value);
  const add = (
    code: string,
    path: string,
    message: string,
    severity: "error" | "warning" = "error",
  ) => diagnostics.push({ severity, code, path, message });
  const finish = (): PlanValidationResult =>
    diagnostics.some((issue) => issue.severity === "error")
      ? { ok: false, diagnostics }
      : { ok: true, plan: value as TrainingPlan, diagnostics };
  if (diagnostics.length) return finish();
  if (
    isObject(value) &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion !== "1.1"
  ) {
    add(
      "unsupported_version",
      "/schemaVersion",
      `Plan schema ${value.schemaVersion} is unsupported; only 1.1 is supported. No 1.0 conversion is available.`,
    );
    return finish();
  }
  if (!validateStructure(value)) {
    diagnostics.push(...structureDiagnostics(validateStructure.errors ?? []));
    return finish();
  }
  const plan = value;
  plan.requiredFeatures.forEach((feature, index) =>
    add(
      "unsupported_feature",
      `/requiredFeatures/${index}`,
      `Required feature '${feature}' is unsupported.`,
    ),
  );
  const entities = new Map<
    string,
    { path: string; type: string; value: JsonObject }
  >();
  const knownObjects: Array<{
    path: string;
    node: SchemaNode;
    value: JsonObject;
  }> = [];
  const walk = (item: unknown, inputSchema: SchemaNode, path: string) => {
    const node = resolveSchema(inputSchema, item);
    if (
      inputSchema.$ref === "#/$defs/Date" &&
      calendarDay(item as string) === undefined
    )
      add(
        "invalid_date",
        path,
        "Use a real Gregorian calendar date in YYYY-MM-DD form.",
      );
    if (Array.isArray(item) && node.items)
      item.forEach((entry, index) =>
        walk(entry, node.items!, child(path, index)),
      );
    if (!isObject(item) || !node.properties) return;
    knownObjects.push({ path, node, value: item });
    if (typeof item.id === "string") {
      if (entities.has(item.id))
        add(
          "duplicate_id",
          child(path, "id"),
          `ID '${item.id}' is already used at ${entities.get(item.id)!.path}.`,
        );
      else entities.set(item.id, { path, type: node.title ?? "", value: item });
    }
    for (const [key, entry] of Object.entries(item)) {
      if (key === "extensions") {
        Object.keys(entry as JsonObject).forEach((namespace) =>
          add(
            "optional_extension",
            child(child(path, key), namespace),
            "Preserved optional extension; its semantics are not interpreted.",
            "warning",
          ),
        );
      } else if (has(node.properties, key))
        walk(entry, node.properties[key], child(path, key));
      else
        add(
          "unknown_optional_field",
          child(path, key),
          "Preserved unknown optional field; it does not change standard plan semantics.",
          "warning",
        );
    }
  };
  walk(plan, schema, "");
  const reference = (id: string, type: string | string[], path: string) => {
    const entity = entities.get(id);
    if (
      !entity ||
      !(Array.isArray(type) ? type : [type]).includes(entity.type)
    ) {
      add(
        "invalid_reference",
        path,
        `Expected an existing ${String(type)} ID; received '${id}'.`,
      );
      return undefined;
    }
    return entity;
  };
  const noteFor = (path: string) =>
    plan.reviewNotes.some(
      (note) =>
        note.path === path ||
        note.path.startsWith(`${path}/`) ||
        path.startsWith(`${note.path}/`),
    );
  const needsReview = (path: string, message: string) => {
    add("structure_needs_review", path, message, "warning");
    if (!noteFor(path))
      add(
        "missing_review_note",
        path,
        "Partial or unsupported structure needs an explanatory reviewNote.",
      );
  };
  const dimension = (
    quantity: Quantity | undefined,
    expected: "distance" | "duration",
    path: string,
  ) => {
    if (
      quantity &&
      !(expected === "distance" ? ["m", "km", "mi"] : ["s", "min"]).includes(
        quantity.unit,
      )
    )
      add("wrong_dimension", `${path}/unit`, `Expected a ${expected} unit.`);
  };
  for (const { path, node, value: item } of knownObjects) {
    if (
      ["RangeQuantity", "PaceTarget"].includes(node.title ?? "") &&
      Number(item.min) > Number(item.max)
    )
      add("invalid_range", path, "Minimum must not exceed maximum.");
    if (
      node.title === "ExactQuantity" &&
      (has(item, "min") || has(item, "max"))
    )
      add(
        "conflicting_quantity",
        path,
        "Use either value or min/max, never both.",
      );
    if (node.title === "RangeQuantity" && has(item, "value"))
      add(
        "conflicting_quantity",
        path,
        "Use either value or min/max, never both.",
      );
    if (node.title === "ReferenceTarget")
      reference(
        item.referenceId as string,
        "PaceReference",
        `${path}/referenceId`,
      );
    if (node.title === "Generator" && typeof item.generatedAt === "string") {
      const stamp = item.generatedAt;
      if (
        calendarDay(stamp.slice(0, 10)) === undefined ||
        Number(stamp.slice(11, 13)) > 23 ||
        Number(stamp.slice(14, 16)) > 59 ||
        Number(stamp.slice(17, 19)) > 59
      )
        add(
          "invalid_timestamp",
          `${path}/generatedAt`,
          "Use a valid UTC timestamp.",
        );
    }
    if (
      node.title === "RecoverySequence" &&
      ["quantity", "movement", "targets"].some((key) => has(item, key))
    )
      add(
        "conflicting_recovery",
        path,
        "A recovery sequence contains ordered components, not a competing interval.",
      );
    if (node.title === "RecoveryInterval" && has(item, "components"))
      add(
        "conflicting_recovery",
        path,
        "Use an interval or an ordered sequence, not both.",
      );
  }
  if (
    plan.manifest.planId === plan.manifest.versionId ||
    plan.manifest.parentVersionId === plan.manifest.versionId
  )
    add(
      "invalid_version_identity",
      "/manifest",
      "Plan, version, and parent-version identities must be distinct.",
    );
  for (const key of ["planId", "versionId"] as const)
    if (entities.has(plan.manifest[key]))
      add(
        "duplicate_id",
        `/manifest/${key}`,
        "Manifest identities cannot reuse an entity ID.",
      );
  plan.reviewNotes.forEach((note, index) => {
    if (!resolves(plan, note.path))
      add(
        "invalid_pointer",
        `/reviewNotes/${index}/path`,
        "Review note must point to an existing document value.",
      );
    add(
      `source_${note.code}`,
      note.path,
      note.message,
      note.code === "missing-source-text" ? "error" : "warning",
    );
  });
  plan.provenance.forEach((entry, index) => {
    const path = `/provenance/${index}`;
    if (!resolves(plan, entry.path))
      add(
        "invalid_pointer",
        `${path}/path`,
        "Provenance must point to an existing document value.",
      );
    const source = reference(
      entry.sourceId,
      ["FileSource", "AuthoredSource"],
      `${path}/sourceId`,
    );
    const expectedKind =
      entry.location.kind === "cell" ? "workbook" : entry.location.kind;
    if (source && source.value.kind !== expectedKind)
      add(
        "source_location_mismatch",
        `${path}/location`,
        "Location kind must match its source kind.",
      );
    if (entry.location.kind === "json" && !pointerParts(entry.location.pointer))
      add(
        "invalid_pointer",
        `${path}/location/pointer`,
        "Use an RFC 6901 source JSON Pointer.",
      );
    if (entry.location.kind === "cell") {
      const match = /^([A-Z]+)(\d+)$/.exec(entry.location.cell)!;
      const column = [...match[1]].reduce(
        (result, c) => result * 26 + c.charCodeAt(0) - 64,
        0,
      );
      if (column > 16384 || Number(match[2]) > 1048576)
        add(
          "invalid_cell",
          `${path}/location/cell`,
          "Cell lies outside Excel worksheet bounds.",
        );
    } else if (has(entry, "formula") || has(entry, "formattedText"))
      add(
        "source_location_mismatch",
        path,
        "Formula and formatted cell text require a workbook cell location.",
      );
  });
  plan.sources.forEach((source, index) => {
    if (source.kind !== "workbook" && has(source, "dateSystem"))
      add(
        "source_kind_conflict",
        `/sources/${index}/dateSystem`,
        "Only a workbook has an Excel date system.",
      );
    if (
      source.kind === "authored" &&
      (has(source, "sha256") || has(source, "fileName"))
    )
      add(
        "source_kind_conflict",
        `/sources/${index}`,
        "A file identity requires a workbook or JSON source kind.",
      );
  });
  // A provenance mapping covers descendants. Imported cells can override a
  // container mapping; source contents are verified by later intake, not here.
  for (const { path, value: item } of knownObjects) {
    if (
      has(item, "coachText") &&
      (item.coachText as string[]).length &&
      !plan.provenance.some(
        (entry) =>
          entry.path === "" ||
          path === entry.path ||
          path.startsWith(`${entry.path}/`) ||
          entry.path === `${path}/coachText`,
      )
    ) {
      (item.coachText as string[]).forEach((_, index) => {
        const textPath = `${path}/coachText/${index}`;
        if (!plan.provenance.some((entry) => entry.path === textPath))
          add(
            "missing_provenance",
            textPath,
            "Coach text needs source provenance.",
          );
      });
    }
  }
  const start = calendarDay(plan.calendar.startDate);
  const end = calendarDay(plan.calendar.endDate);
  if (start !== undefined && end !== undefined && start > end)
    add(
      "invalid_calendar",
      "/calendar",
      "Calendar start must not follow its end.",
    );
  let expectedStart = start;
  const membership = new Map<
    string,
    { sessionId: string; order: number; quantity?: Quantity }
  >();
  const workoutOrders = new Map<string, number>();
  plan.weeks.forEach((week, wi) => {
    const wp = `/weeks/${wi}`;
    const ws = calendarDay(week.startDate),
      we = calendarDay(week.endDate);
    if (week.number !== wi + 1)
      add(
        "week_order",
        `${wp}/number`,
        "Week numbers must be contiguous and start at 1.",
      );
    if (ws !== undefined && we !== undefined) {
      const length = we - ws + 1;
      const weekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1;
      const calendarWeek = (day: number) =>
        Math.floor((day + 4 - plan.calendar.weekStartsOn) / 7);
      if (
        length < 1 ||
        length > 7 ||
        calendarWeek(ws) !== calendarWeek(we) ||
        (wi > 0 && weekday(ws) !== plan.calendar.weekStartsOn) ||
        (wi < plan.weeks.length - 1 &&
          (weekday(we) % 7) + 1 !== plan.calendar.weekStartsOn)
      )
        add(
          "invalid_week_span",
          wp,
          "Weeks follow the calendar weekday; only boundary weeks may be partial.",
        );
      if (ws !== expectedStart)
        add(
          "calendar_gap",
          `${wp}/startDate`,
          "Weeks must cover the calendar in order without gaps or overlaps.",
        );
      if (week.days.length !== length)
        add(
          "day_coverage",
          `${wp}/days`,
          "Every calendar date needs one explicit day group.",
        );
      expectedStart = we + 1;
    }
    dimension(week.coreTarget, "distance", `${wp}/coreTarget`);
    dimension(week.flexibleTarget, "distance", `${wp}/flexibleTarget`);
    week.days.forEach((day, di) => {
      const dp = `${wp}/days/${di}`;
      const dayNumber = calendarDay(day.date);
      if (ws !== undefined && dayNumber !== undefined && dayNumber !== ws + di)
        add(
          "day_order",
          `${dp}/date`,
          "Days must cover their week once, in calendar order.",
        );
      if (day.kind !== "training" && day.sessions.length)
        add(
          "day_kind_conflict",
          `${dp}/sessions`,
          "Rest and unspecified days cannot contain sessions.",
        );
      if (day.kind === "training" && !day.sessions.length)
        add(
          "missing_session",
          `${dp}/sessions`,
          "A training day needs at least one session.",
        );
      if (day.kind === "unspecified")
        add(
          "unspecified_day",
          dp,
          "Source did not establish training or rest; review required.",
          "warning",
        );
      if (day.restDistance) {
        dimension(day.restDistance, "distance", `${dp}/restDistance`);
        if (
          day.kind !== "rest" ||
          day.restDistance.value !== 0 ||
          has(day.restDistance, "min")
        )
          add(
            "invalid_rest_distance",
            `${dp}/restDistance`,
            "Only explicit zero distance is allowed on a rest day.",
          );
      }
      const mains = day.sessions.filter((session) => session.role === "main");
      if (mains.length > 1)
        add(
          "multiple_main_sessions",
          `${dp}/sessions`,
          "At most one explicitly designated main session is allowed; use independent for separate sessions.",
        );
      if (new Set(day.phaseIds).size !== (day.phaseIds?.length ?? 0))
        add(
          "duplicate_phase",
          `${dp}/phaseIds`,
          "Phase memberships must be unique.",
        );
      day.phaseIds?.forEach((phaseId, index) => {
        const found = reference(phaseId, "Phase", `${dp}/phaseIds/${index}`);
        const phase = plan.phases.find((candidate) => candidate.id === phaseId);
        if (found && phase?.span) {
          const span = phase.span;
          if (span.kind === "weeks" && !span.weekIds.includes(week.id))
            add(
              "phase_membership",
              `${dp}/phaseIds/${index}`,
              "Day is outside the declared phase weeks.",
            );
          if (
            span.kind === "dates" &&
            (day.date < span.startDate || day.date > span.endDate)
          )
            add(
              "phase_membership",
              `${dp}/phaseIds/${index}`,
              "Day is outside the declared phase dates.",
            );
        }
      });
      day.sessions.forEach((session, si) => {
        const sp = `${dp}/sessions/${si}`;
        if (session.role === "double") {
          if (
            !session.primarySessionId ||
            !day.sessions.some(
              (candidate) =>
                candidate.id === session.primarySessionId &&
                candidate.role === "main",
            )
          )
            add(
              "invalid_double_link",
              `${sp}/primarySessionId`,
              "A double needs an explicit main-session link in the same day group.",
            );
        } else if (has(session, "primarySessionId"))
          add(
            "unexpected_primary_link",
            `${sp}/primarySessionId`,
            "Only a double may have a primary-session link.",
          );
        if (
          session.participation === "optional" &&
          session.completionClass !== "flexible"
        )
          add(
            "optional_core",
            `${sp}/completionClass`,
            "Optional sessions must stay outside core completion.",
          );
        if (session.role === "unspecified" || session.runType === "unspecified")
          add(
            "unspecified_session",
            sp,
            "Source organization or run type is unresolved; no main relationship was inferred.",
            "warning",
          );
        dimension(session.distance, "distance", `${sp}/distance`);
        dimension(session.duration, "duration", `${sp}/duration`);
        const workout = session.workout;
        if (!workout) return;
        const bp = `${sp}/workout/blocks`;
        if (workout.structureStatus !== "complete")
          needsReview(
            `${sp}/workout`,
            "Workout structure is incomplete; consult exact coach text.",
          );
        if (workout.structureStatus === "unstructured" && workout.blocks.length)
          add(
            "structure_status_conflict",
            bp,
            "Unstructured workouts have no parsed blocks; use partial when some structure is known.",
          );
        if (workout.structureStatus === "complete" && !workout.blocks.length)
          add(
            "empty_workout",
            bp,
            "A complete structured workout needs at least one block.",
          );
        const trailing = (block: ExerciseBlock) => {
          const set = block.sets.at(-1)!;
          return Boolean(
            block.recoveryAfter ||
            set.recoveryAfter ||
            set.repetitions.at(-1)!.recoveryAfter,
          );
        };
        workout.blocks.forEach((block, bi) => {
          const blockPath = `${bp}/${bi}`;
          if (block.role === "recovery") {
            const preceding = workout.blocks[bi - 1];
            if (!preceding || preceding.id !== block.afterId)
              add(
                "invalid_recovery_placement",
                `${blockPath}/afterId`,
                "An ordered recovery must name the immediately preceding block.",
              );
            if (
              preceding?.role !== "recovery" &&
              preceding &&
              trailing(preceding)
            )
              add(
                "duplicate_recovery",
                blockPath,
                "This boundary already has an attached recovery; choose one representation.",
              );
            if (["sets", "recoveryAfter"].some((key) => has(block, key)))
              add(
                "conflicting_recovery",
                blockPath,
                "An ordered recovery block cannot also contain work sets or an attached recovery.",
              );
            return;
          }
          if (has(block, "recovery") || has(block, "afterId"))
            add(
              "conflicting_recovery",
              blockPath,
              "Exercise blocks use recoveryAfter, not recovery-block fields.",
            );
          block.sets.forEach((set, setIndex) => {
            const setPath = `${blockPath}/sets/${setIndex}`;
            if (set.index !== setIndex + 1)
              add(
                "set_order",
                `${setPath}/index`,
                "Set indices must match their one-based array positions.",
              );
            const order = workoutOrders.get(session.id) ?? 0;
            membership.set(set.id, {
              sessionId: session.id,
              order,
              quantity: set.quantity,
            });
            workoutOrders.set(session.id, order + 1);
            set.repetitions.forEach((rep, ri) => {
              const rp = `${setPath}/repetitions/${ri}`;
              if (rep.index !== ri + 1)
                add(
                  "repetition_order",
                  `${rp}/index`,
                  "Repetition indices must match their one-based array positions.",
                );
              const repOrder = workoutOrders.get(session.id)!;
              membership.set(rep.id, {
                sessionId: session.id,
                order: repOrder,
                quantity: rep.quantity ?? set.quantity,
              });
              workoutOrders.set(session.id, repOrder + 1);
              if (
                ri === set.repetitions.length - 1 &&
                rep.recoveryAfter &&
                set.recoveryAfter
              )
                add(
                  "duplicate_recovery",
                  `${rp}/recoveryAfter`,
                  "The set already defines recovery at this boundary.",
                );
            });
            set.hammerRepetitionIndices?.forEach((index, hi) => {
              if (index > set.repetitions.length)
                add(
                  "invalid_hammer_index",
                  `${setPath}/hammerRepetitionIndices/${hi}`,
                  "Hammer index must identify an existing repetition; it never adds one.",
                );
            });
          });
          const finalSet = block.sets.at(-1)!;
          if (
            block.recoveryAfter &&
            (finalSet.recoveryAfter ||
              finalSet.repetitions.at(-1)!.recoveryAfter)
          )
            add(
              "duplicate_recovery",
              `${blockPath}/recoveryAfter`,
              "The final set or repetition already defines recovery at this boundary.",
            );
        });
      });
    });
  });
  if (end !== undefined && expectedStart !== end + 1)
    add(
      "calendar_coverage",
      "/weeks",
      "Weeks must end on the declared calendar end date.",
    );
  plan.phases.forEach((phase, index) => {
    const path = `/phases/${index}/span`;
    if (!phase.span)
      add(
        "unspecified_phase_span",
        `/phases/${index}`,
        "Phase boundaries were not supplied; none were inferred.",
        "warning",
      );
    else if (phase.span.kind === "weeks") {
      const indices = phase.span.weekIds.map((id, i) => {
        reference(id, "Week", `${path}/weekIds/${i}`);
        return plan.weeks.findIndex((week) => week.id === id);
      });
      if (indices.some((value, i) => i > 0 && value <= indices[i - 1]))
        add(
          "phase_week_order",
          path,
          "Phase weeks must be unique and in plan order.",
        );
    } else {
      const a = phase.span.startDate,
        b = phase.span.endDate;
      if (a > b || a < plan.calendar.startDate || b > plan.calendar.endDate)
        add(
          "invalid_phase_span",
          path,
          "Phase dates must be ordered and within the plan calendar.",
        );
    }
  });
  plan.paceReferences.forEach((pace, index) => {
    const path = `/paceReferences/${index}`;
    if (pace.kind === "zone" && !pace.zone)
      add(
        "missing_zone",
        `${path}/zone`,
        "A zone reference needs its explicit zone.",
      );
    if (pace.kind !== "zone" && has(pace, "zone"))
      add(
        "pace_kind_conflict",
        `${path}/zone`,
        "Only zone references may declare a zone.",
      );
    if (pace.kind !== "race" && has(pace, "raceDistance"))
      add(
        "pace_kind_conflict",
        `${path}/raceDistance`,
        "Only race references may declare a race distance.",
      );
    dimension(pace.raceDistance, "distance", `${path}/raceDistance`);
  });
  plan.progressions.forEach((progression, index) => {
    const path = `/progressions/${index}`;
    const session = reference(
      progression.workoutSessionId,
      "Session",
      `${path}/workoutSessionId`,
    );
    if (session && !session.value.workout)
      add(
        "missing_workout",
        `${path}/workoutSessionId`,
        "Progression must belong to a structured workout.",
      );
    let previous = -1;
    progression.sequence.forEach((id, si) => {
      reference(
        id,
        progression.scope === "set" ? "WorkoutSet" : "Repetition",
        `${path}/sequence/${si}`,
      );
      const owner = membership.get(id);
      if (!owner || owner.sessionId !== progression.workoutSessionId)
        add(
          "cross_workout_progression",
          `${path}/sequence/${si}`,
          "Structured progression is limited to one workout.",
        );
      else if (owner.order <= previous)
        add(
          "progression_order",
          `${path}/sequence/${si}`,
          "Progression sequence must follow workout order.",
        );
      if (owner) previous = owner.order;
      const increment = progression.parameters?.quantityIncrement;
      if (increment && owner?.quantity) {
        const isDistance = (unit: string) => ["m", "km", "mi"].includes(unit);
        if (isDistance(increment.unit) !== isDistance(owner.quantity.unit))
          add(
            "progression_dimension",
            `${path}/parameters/quantityIncrement/unit`,
            "Progression increment must have the same dimension as the specified work quantity.",
          );
      }
    });
    if (!progression.coachText.length)
      add(
        "missing_progression_text",
        `${path}/coachText`,
        "A progression must preserve its original rule text.",
      );
    plan.progressions.slice(0, index).forEach((earlier, earlierIndex) => {
      if (
        earlier.workoutSessionId !== progression.workoutSessionId ||
        earlier.scope !== progression.scope ||
        !earlier.sequence.some((id) => progression.sequence.includes(id))
      )
        return;
      for (const parameter of ["quantityIncrement", "paceIncrement"] as const) {
        const a = earlier.parameters?.[parameter],
          b = progression.parameters?.[parameter];
        if (a && b && (a.value !== b.value || a.unit !== b.unit))
          add(
            "progression_conflict",
            `${path}/parameters/${parameter}`,
            `Overlapping progression differs from /progressions/${earlierIndex}. Preserve both instructions and review; no rule was executed.`,
            "warning",
          );
      }
    });
  });
  // Ambiguous movement is retained explicitly, not guessed or defaulted.
  for (const { path, node, value: item } of knownObjects)
    if (node.title === "RecoveryInterval" && item.movement === "unspecified")
      add(
        "unspecified_recovery_movement",
        `${path}/movement`,
        "Recovery movement was not specified; review the coach text.",
        "warning",
      );
  return finish();
}

/** Parse without accessing files, application state, or persistence. */
export function parseTrainingPlan(text: string): PlanValidationResult {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "input_limit",
          path: "",
          message: "Plan JSON exceeds 10 MiB.",
        },
      ],
    };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "invalid_json",
          path: "",
          message: "The document is not valid JSON.",
        },
      ],
    };
  }
  // JSON.parse silently keeps the last duplicate member. Reject that ambiguity
  // before returning a document, including escaped-equivalent property names.
  const stack: Array<{ kind: string; keys: Set<string>; expectKey: boolean }> =
    [];
  const tokens =
    /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0],
      frame = stack.at(-1);
    if (token === "{" || token === "[")
      stack.push({ kind: token, keys: new Set(), expectKey: true });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && frame) frame.expectKey = true;
    else if (frame?.kind === "{" && frame.expectKey && token.startsWith('"')) {
      const key = JSON.parse(token) as string;
      if (frame.keys.has(key))
        return {
          ok: false,
          diagnostics: [
            {
              severity: "error",
              code: "duplicate_json_key",
              path: "",
              message:
                "Duplicate JSON object members are ambiguous and cannot be preserved losslessly.",
            },
          ],
        };
      frame.keys.add(key);
      frame.expectKey = false;
    }
  }
  return validateTrainingPlan(value);
}

/** Serialize only valid contracts, retaining unknown metadata and exact strings. */
export function serializeTrainingPlan(plan: TrainingPlan): string {
  const result = validateTrainingPlan(plan);
  if (!result.ok)
    throw new Error(
      `Invalid training plan: ${result.diagnostics.find((issue) => issue.severity === "error")?.code}`,
    );
  return JSON.stringify(plan, null, 2);
}

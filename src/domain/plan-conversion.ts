import schema from "../../schemas/training-plan/1.1.schema.json";
import type { PlanDiagnostic } from "./training-plan-contract";

/** Presentation only: the T01 validator remains the rule authority. */
export function validationDescription(issue: PlanDiagnostic): string {
  if (issue.severity === "warning") return `Review needed: ${issue.message}`;
  if (issue.code === "invalid_json")
    return "This file cannot be read as JSON. Ask the AI assistant to correct the file format.";
  if (issue.code === "duplicate_json_key")
    return "The file repeats a field name. Ask the AI assistant to remove the ambiguity without losing instructions.";
  if (issue.code === "schema.required")
    return `A required field is missing at ${issue.path || "/"}.`;
  if (issue.code.startsWith("schema."))
    return `A field has the wrong format or an unsupported value at ${issue.path || "/"}.`;
  return issue.message;
}

// Clipboard output is constructed from this closed catalog and schema-defined
// locations. Diagnostic messages and source-provided review-note paths are never
// copied, including for future/unknown diagnostic codes.
const safeDescriptions: Readonly<Record<string, string>> = {
  "schema.required": "A required field is missing.",
  "schema.type": "A field has the wrong JSON type.",
  "schema.enum": "A field uses an unsupported value.",
  "schema.const": "A field does not match its required value.",
  "schema.pattern": "A field does not match its required format.",
  "schema.oneOf": "A value must match exactly one supported structure.",
  "schema.anyOf": "A value must match a supported structure.",
  "schema.minItems": "A collection has too few entries.",
  "schema.maxItems": "A collection has too many entries.",
  "schema.uniqueItems": "A collection contains duplicate entries.",
  "schema.minLength": "Text is shorter than permitted.",
  "schema.maxLength": "Text is longer than permitted.",
  "schema.minimum": "A number is below its permitted minimum.",
  "schema.maximum": "A number exceeds its permitted maximum.",
  "schema.exclusiveMinimum": "A number must be above its minimum.",
  "schema.propertyNames": "A metadata property name has an unsupported format.",
  invalid_json: "The document is not valid JSON.",
  duplicate_json_key: "Duplicate JSON field names are ambiguous.",
  input_limit: "The input exceeds a supported size or complexity limit.",
  not_json: "The input contains an unsupported JSON value.",
  unsupported_version: "Only Training Plan JSON 1.1 is supported.",
  unsupported_feature: "A required feature is unsupported.",
  duplicate_id: "An identifier is reused where uniqueness is required.",
  invalid_reference:
    "A reference does not identify an existing entity of the required type.",
  invalid_pointer:
    "A JSON Pointer does not identify a supported existing value.",
  invalid_date: "Use a real Gregorian date in YYYY-MM-DD form.",
  invalid_timestamp: "Use a valid UTC timestamp.",
  invalid_cell: "A cell reference lies outside supported worksheet bounds.",
  invalid_range: "Minimum must not exceed maximum.",
  conflicting_quantity: "Use either value or min/max, never both.",
  wrong_dimension: "A quantity has the wrong distance or duration unit.",
  conflicting_recovery: "Recovery contains competing representations.",
  duplicate_recovery: "Recovery is duplicated at the same boundary.",
  invalid_recovery_placement:
    "Ordered recovery must follow its referenced block.",
  invalid_version_identity:
    "Plan, version and parent-version identities must be distinct.",
  source_location_mismatch:
    "Provenance location kind must match its source kind.",
  source_kind_conflict: "Source metadata conflicts with its source kind.",
  missing_provenance: "Coach text needs covering source provenance.",
  invalid_calendar: "Calendar start must not follow its end.",
  calendar_coverage: "Weeks must cover the declared calendar.",
  calendar_gap: "Weeks must be ordered without gaps or overlaps.",
  week_order: "Week numbers must be contiguous from one.",
  invalid_week_span:
    "Week boundaries must follow the declared calendar weekday.",
  day_coverage: "Every calendar date needs one day group.",
  day_order: "Days must cover their week once in calendar order.",
  day_kind_conflict: "Rest and unspecified days cannot contain sessions.",
  missing_session: "A training day needs at least one session.",
  invalid_rest_distance:
    "Rest distance is permitted only for an explicit zero on a rest day.",
  multiple_main_sessions: "A day has more than one designated main session.",
  duplicate_phase: "Phase memberships must be unique.",
  phase_membership: "A day is outside its declared phase.",
  invalid_double_link: "A double needs a link to its same-day main session.",
  unexpected_primary_link: "Only a double may have a primary-session link.",
  optional_core: "Optional sessions must be flexible rather than core.",
  missing_review_note:
    "Partial or unsupported structure needs an explanatory review note.",
  structure_status_conflict:
    "Parsed blocks conflict with the declared workout structure status.",
  empty_workout: "A complete workout needs at least one block.",
  set_order: "Set indices must match their one-based array order.",
  repetition_order:
    "Repetition indices must match their one-based array order.",
  invalid_hammer_index: "A hammer index must identify an existing repetition.",
  phase_week_order: "Phase weeks must be unique and in plan order.",
  invalid_phase_span:
    "Phase boundaries must be ordered and within the calendar.",
  missing_zone: "A zone reference needs its explicit zone.",
  pace_kind_conflict: "Pace metadata conflicts with its reference kind.",
  missing_workout: "A progression must belong to a structured workout.",
  cross_workout_progression:
    "Structured progression is limited to one workout.",
  progression_order: "A progression sequence must follow workout order.",
  progression_dimension:
    "A progression increment has the wrong quantity dimension.",
  missing_progression_text:
    "A progression must preserve its original rule text.",
  progression_conflict:
    "Overlapping progression instructions conflict and need review.",
  unspecified_day: "Training or rest was not established for a date.",
  unspecified_session: "Session organization or run type needs review.",
  unspecified_phase_span: "Phase boundaries were not supplied.",
  unspecified_recovery_movement: "Recovery movement was not specified.",
  structure_needs_review:
    "Incomplete workout structure requires comparison with the coach document.",
  unknown_optional_field: "An uninterpreted optional field requires review.",
  optional_extension: "An uninterpreted metadata extension requires review.",
  source_ambiguous:
    "A source interpretation is ambiguous. Inspect the original note locally.",
  source_conflict:
    "A source conflict requires review. Inspect the original note locally.",
  source_unsupported:
    "A source instruction is not structurally supported. Inspect the original note locally.",
  "source_missing-source-text":
    "Expected source text is missing. Inspect the original note locally before correction.",
};
const sourceNoteCodes = new Set([
  "source_ambiguous",
  "source_conflict",
  "source_unsupported",
  "source_missing-source-text",
]);

type LocationSchema = {
  $ref?: string;
  properties?: Record<string, LocationSchema>;
  items?: LocationSchema;
  oneOf?: LocationSchema[];
  anyOf?: LocationSchema[];
};
const locationSchema = schema as LocationSchema;
const definitions = schema.$defs as unknown as Record<string, LocationSchema>;
function alternatives(node: LocationSchema): LocationSchema[] {
  if (node.$ref)
    return alternatives(definitions[node.$ref.slice("#/$defs/".length)]);
  return node.oneOf || node.anyOf
    ? (node.oneOf ?? node.anyOf)!.flatMap(alternatives)
    : [node];
}
function safeStructuralLocation(path: string): string | undefined {
  if (path === "") return "document root";
  if (!path.startsWith("/") || path.length > 2048) return;
  const parts = path.slice(1).split("/");
  if (parts.length > 64) return;
  let nodes = [locationSchema];
  const safeParts: string[] = [];
  for (const part of parts) {
    const next: LocationSchema[] = [];
    for (const node of nodes.flatMap(alternatives)) {
      if (node.properties && Object.hasOwn(node.properties, part)) {
        next.push(node.properties[part]);
      } else if (
        node.items &&
        /^(0|[1-9]\d{0,5})$/.test(part) &&
        Number(part) < 200000
      ) {
        next.push(node.items);
      }
    }
    if (!next.length) return;
    // Reached only through closed schema properties or bounded array indices.
    safeParts.push(part);
    nodes = next;
  }
  return `/${safeParts.join("/")}`;
}
function safeDiagnostic(issue: PlanDiagnostic): string {
  const known = Object.hasOwn(safeDescriptions, issue.code);
  const code = known ? issue.code : "unrecognized_diagnostic";
  const description = known
    ? safeDescriptions[code]
    : "A validation issue requires local review; its unrecognized details were omitted.";
  // Source notes can supply arbitrary paths, even plausible structural pointers.
  const location =
    known && !sourceNoteCodes.has(code)
      ? safeStructuralLocation(issue.path)
      : undefined;
  return `${issue.severity === "warning" ? "WARNING" : "ERROR"} [${code}] ${location ?? "location withheld; inspect local validation details"}: ${description}`;
}
export function validationFeedback(diagnostics: PlanDiagnostic[]): string {
  return [
    "Correct my Stride Plan Training Plan JSON 1.1 using the actual validation feedback below.",
    "Use the original document and authoritative schema already supplied. Correct only the reported problems and directly necessary references. Do not invent values, coach wording, source hashes or locations, or modify unrelated workouts. Preserve original instructions and all unaffected sessions. Ask for clarification only when essential information cannot be represented truthfully.",
    "Errors block import; warnings require review but do not block saving a draft. This feedback uses allowlisted codes and generic descriptions, with schema-defined structural locations only where safe. Source-provided messages, values and review-note paths are omitted; inspect the exact diagnostics locally. No plan contents or filenames are included here.",
    ...diagnostics.map(safeDiagnostic),
    "Return a corrected downloadable UTF-8 file named stride-plan-training-plan.json containing JSON only, plus a separate short explanation of the corrections and any unresolved uncertainty. Do not claim validation unless you actually ran a validator.",
  ].join("\n\n");
}

/**
 * Controlled vocabularies for the athlete profile and daily check-ins.
 *
 * Each list is `as const` so we get both a runtime array (for validation and
 * dropdowns) and a derived TypeScript union type. Anything not on a list is
 * captured in a free-text "other"/note field on the relevant section.
 */

// --- Sports ----------------------------------------------------------------
export const SPORTS = [
  "soccer",
  "basketball",
  "american_football",
  "baseball",
  "track",
  "cross_country",
  "swimming",
  "volleyball",
  "lacrosse",
  "hockey",
  "tennis",
  "other",
] as const;
export type Sport = (typeof SPORTS)[number];

// --- Soccer positions (used when a sport is soccer) ------------------------
export const SOCCER_POSITIONS = [
  "goalkeeper",
  "defender",
  "fullback",
  "midfielder",
  "winger",
  "forward",
] as const;
export type SoccerPosition = (typeof SOCCER_POSITIONS)[number];

// --- Biological sex (drives baseline physiology / nutrition calculations) --
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

// --- Dominant foot ---------------------------------------------------------
export const DOMINANT_FEET = ["right", "left", "both"] as const;
export type DominantFoot = (typeof DOMINANT_FEET)[number];

// --- Competition level -----------------------------------------------------
export const COMPETITION_LEVELS = [
  "recreational",
  "high_school",
  "college",
  "professional",
  // Adults
  "amateur",
  "rec_league",
  "over_age_league",
  "training_only",
] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];

// --- Season status ---------------------------------------------------------
export const SEASON_STATUSES = [
  "off_season",
  "pre_season",
  "in_season",
  "playoffs",
] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

// --- Training intensity ----------------------------------------------------
export const TRAINING_INTENSITIES = ["light", "moderate", "high"] as const;
export type TrainingIntensity = (typeof TRAINING_INTENSITIES)[number];

// --- Typical meal pattern --------------------------------------------------
export const MEAL_PATTERNS = [
  "three_meals",
  "three_meals_plus_snacks",
  "small_frequent",
  "intermittent_fasting",
] as const;
export type MealPattern = (typeof MEAL_PATTERNS)[number];

// --- Allergens (HARD constraint: never recommend a food containing one) ----
export const ALLERGENS = [
  "peanut",
  "tree_nut",
  "milk",
  "egg",
  "wheat",
  "gluten",
  "soy",
  "fish",
  "shellfish",
  "sesame",
  "other",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

// --- Intolerances ----------------------------------------------------------
export const INTOLERANCES = [
  "lactose",
  "gluten",
  "fructose",
  "caffeine",
  "histamine",
  "other",
] as const;
export type Intolerance = (typeof INTOLERANCES)[number];

// --- Dietary restrictions (religious / ethical / medical — HARD constraints)
export const DIETS = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "dairy_free",
  "gluten_free",
  "nut_free",
  "no_pork",
  "no_red_meat",
] as const;
export type Diet = (typeof DIETS)[number];

// --- Medical diets (health data: private, never shown to coaches except celiac as "gluten, strict")
export const MEDICAL_DIETS = ["celiac", "type1_diabetes", "sensitive_stomach", "low_fodmap"] as const;
export type MedicalDietId = (typeof MEDICAL_DIETS)[number];

// --- Preferred diet (single lifestyle choice; "none" allowed) --------------
export const PREFERRED_DIETS = [
  "none",
  "vegetarian",
  "vegan",
  "pescatarian",
  "keto",
  "paleo",
  "mediterranean",
  "other",
] as const;
export type PreferredDiet = (typeof PREFERRED_DIETS)[number];

// --- Recovery methods ------------------------------------------------------
export const RECOVERY_METHODS = [
  "stretching",
  "foam_rolling",
  "ice_bath",
  "massage",
  "compression",
  "sauna",
  "yoga",
  "other",
] as const;
export type RecoveryMethod = (typeof RECOVERY_METHODS)[number];

// --- Nap frequency ---------------------------------------------------------
export const NAP_FREQUENCIES = [
  "never",
  "rarely",
  "sometimes",
  "often",
  "daily",
] as const;
export type NapFrequency = (typeof NAP_FREQUENCIES)[number];

// --- Recent illness status -------------------------------------------------
export const ILLNESS_STATUSES = [
  "healthy",
  "mild_symptoms",
  "sick",
  "recovering",
] as const;
export type IllnessStatus = (typeof ILLNESS_STATUSES)[number];

// --- Goals (multi-select) --------------------------------------------------
export const GOALS = [
  "build_muscle",
  "improve_endurance",
  "improve_recovery",
  "gain_weight",
  "lose_weight",
  "maintain_weight",
  "improve_game_day_performance",
  "return_from_injury",
] as const;
export type Goal = (typeof GOALS)[number];

// --- Wearable devices (advanced/optional) ----------------------------------
export const WEARABLES = [
  "apple_watch",
  "garmin",
  "whoop",
  "oura",
  "polar",
  "fitbit",
  "other",
] as const;
export type Wearable = (typeof WEARABLES)[number];

// --- Event types on the athlete's schedule ---------------------------------
export const EVENT_TYPES = [
  "match",
  "training",
  "recovery",
  "travel",
  "tournament",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_IMPORTANCE = ["low", "normal", "high"] as const;
export type EventImportance = (typeof EVENT_IMPORTANCE)[number];

// --- Mood (daily check-in) -------------------------------------------------
export const MOODS = ["great", "good", "neutral", "low", "bad"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * Numeric plausibility bounds used by validation. Centralised so they are easy
 * to tune. Scales of 1-10 are validated separately via SCALE_MIN/SCALE_MAX.
 */
export const BOUNDS = {
  heightCm: { min: 100, max: 230 },
  bodyMassKg: { min: 20, max: 160 },
  bodyFatPct: { min: 3, max: 50 },
  age: { min: 6, max: 90 },
  yearsPlaying: { min: 0, max: 50 },
  trainingDaysPerWeek: { min: 0, max: 14 },
  avgSessionMinutes: { min: 0, max: 360 },
  matchesPerWeek: { min: 0, max: 14 },
  strengthSessionsPerWeek: { min: 0, max: 14 },
  mealsPerDay: { min: 1, max: 10 },
  waterIntakeLitres: { min: 0, max: 12 },
  caffeineMgPerDay: { min: 0, max: 1500 },
  avgSleepHours: { min: 0, max: 16 },
  restingHeartRate: { min: 30, max: 120 },
  hrvMs: { min: 0, max: 250 },
  sweatRateLitresPerHour: { min: 0, max: 5 },
  estimatedCalorieExpenditure: { min: 0, max: 10000 },
  sleepHoursLastNight: { min: 0, max: 16 },
  sessionMinutes: { min: 0, max: 600 },
} as const;

/** Inclusive bounds for 1-10 subjective scales. */
export const SCALE_MIN = 1;
export const SCALE_MAX = 10;

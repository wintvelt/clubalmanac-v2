/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _test from "../_test.js";
import type * as albums from "../albums.js";
import type * as crons from "../crons.js";
import type * as features from "../features.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailTemplates from "../lib/emailTemplates.js";
import type * as lib_exifOrientation from "../lib/exifOrientation.js";
import type * as lib_mailjet from "../lib/mailjet.js";
import type * as migration from "../migration.js";
import type * as monitoring from "../monitoring.js";
import type * as photoMetadata from "../photoMetadata.js";
import type * as photos from "../photos.js";
import type * as ratings from "../ratings.js";
import type * as smoke from "../smoke.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _test: typeof _test;
  albums: typeof albums;
  crons: typeof crons;
  features: typeof features;
  groups: typeof groups;
  http: typeof http;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/email": typeof lib_email;
  "lib/emailTemplates": typeof lib_emailTemplates;
  "lib/exifOrientation": typeof lib_exifOrientation;
  "lib/mailjet": typeof lib_mailjet;
  migration: typeof migration;
  monitoring: typeof monitoring;
  photoMetadata: typeof photoMetadata;
  photos: typeof photos;
  ratings: typeof ratings;
  smoke: typeof smoke;
  uploads: typeof uploads;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

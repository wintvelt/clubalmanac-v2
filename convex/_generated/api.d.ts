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
import type * as accountDeletion from "../accountDeletion.js";
import type * as albums from "../albums.js";
import type * as crons from "../crons.js";
import type * as features from "../features.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as invites from "../invites.js";
import type * as lib_accountState from "../lib/accountState.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailTemplates from "../lib/emailTemplates.js";
import type * as lib_exifOrientation from "../lib/exifOrientation.js";
import type * as lib_formatSet from "../lib/formatSet.js";
import type * as lib_jpegMeta from "../lib/jpegMeta.js";
import type * as lib_mailjet from "../lib/mailjet.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_photoAccess from "../lib/photoAccess.js";
import type * as lib_photoFormats from "../lib/photoFormats.js";
import type * as lib_profilePhoto from "../lib/profilePhoto.js";
import type * as lib_selfTestImages from "../lib/selfTestImages.js";
import type * as lib_shapes from "../lib/shapes.js";
import type * as lib_testGate from "../lib/testGate.js";
import type * as lib_unpublish from "../lib/unpublish.js";
import type * as lib_upload from "../lib/upload.js";
import type * as migration from "../migration.js";
import type * as monitoring from "../monitoring.js";
import type * as photoFormats from "../photoFormats.js";
import type * as photoMetadata from "../photoMetadata.js";
import type * as photos from "../photos.js";
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
  accountDeletion: typeof accountDeletion;
  albums: typeof albums;
  crons: typeof crons;
  features: typeof features;
  groups: typeof groups;
  http: typeof http;
  images: typeof images;
  invites: typeof invites;
  "lib/accountState": typeof lib_accountState;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/email": typeof lib_email;
  "lib/emailTemplates": typeof lib_emailTemplates;
  "lib/exifOrientation": typeof lib_exifOrientation;
  "lib/formatSet": typeof lib_formatSet;
  "lib/jpegMeta": typeof lib_jpegMeta;
  "lib/mailjet": typeof lib_mailjet;
  "lib/names": typeof lib_names;
  "lib/photoAccess": typeof lib_photoAccess;
  "lib/photoFormats": typeof lib_photoFormats;
  "lib/profilePhoto": typeof lib_profilePhoto;
  "lib/selfTestImages": typeof lib_selfTestImages;
  "lib/shapes": typeof lib_shapes;
  "lib/testGate": typeof lib_testGate;
  "lib/unpublish": typeof lib_unpublish;
  "lib/upload": typeof lib_upload;
  migration: typeof migration;
  monitoring: typeof monitoring;
  photoFormats: typeof photoFormats;
  photoMetadata: typeof photoMetadata;
  photos: typeof photos;
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

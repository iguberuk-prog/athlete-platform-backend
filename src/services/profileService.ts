/**
 * Profile service — the business logic between the HTTP layer and the database.
 *
 * Responsibilities:
 *  - run safety validation before anything is written
 *  - enforce owner-only access via the repository contract
 *  - translate outcomes into typed results the HTTP layer can map to status codes
 *
 * It deliberately knows nothing about HTTP or about which database is in use.
 */

import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import {
  validateProfileInput,
  type ValidationError,
} from "../domain/validation.js";
import type { AthleteProfileRepository } from "../data/repository.js";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "validation"; errors: ValidationError[] }
  | { ok: false; code: "not_found" };

export class ProfileService {
  constructor(private readonly repo: AthleteProfileRepository) {}

  async create(
    ownerId: string,
    input: ProfileInput,
  ): Promise<ServiceResult<AthleteProfile>> {
    const result = validateProfileInput(input);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    const value = await this.repo.create(ownerId, input);
    return { ok: true, value };
  }

  async get(ownerId: string, id: string): Promise<ServiceResult<AthleteProfile>> {
    const value = await this.repo.getById(ownerId, id);
    return value ? { ok: true, value } : { ok: false, code: "not_found" };
  }

  async list(ownerId: string): Promise<AthleteProfile[]> {
    return this.repo.listByOwner(ownerId);
  }

  async update(
    ownerId: string,
    id: string,
    input: ProfileInput,
  ): Promise<ServiceResult<AthleteProfile>> {
    const result = validateProfileInput(input);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    const value = await this.repo.update(ownerId, id, input);
    return value ? { ok: true, value } : { ok: false, code: "not_found" };
  }

  async delete(ownerId: string, id: string): Promise<ServiceResult<true>> {
    const removed = await this.repo.delete(ownerId, id);
    return removed ? { ok: true, value: true } : { ok: false, code: "not_found" };
  }
}

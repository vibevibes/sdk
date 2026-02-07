/**
 * Storage adapter interface for vibe vibes
 * Allows multiple storage backends: in-memory, Supabase, GitHub, etc.
 */

export interface ExperienceListing {
  id: string;
  title: string;
  description: string;
  version: string;
  source: 'builtin' | 'github' | 'supabase';
  github_repo?: string;
  github_url?: string;
}

export interface RoomState {
  roomId: string;
  experienceId: string;
  sharedState: Record<string, any>;
  updatedAt: number;
}

export interface StorageToolEvent {
  id: string;
  ts: number;
  actor_id: string;
  tool: string;
  input: unknown;
  output: unknown;
}

/**
 * Storage adapter interface
 * All methods are async to support both local and remote storage
 */
export interface StorageAdapter {
  // Room state operations
  saveRoomState(roomId: string, state: RoomState): Promise<void>;
  loadRoomState(roomId: string): Promise<RoomState | null>;

  // Event log operations
  appendEvent(roomId: string, event: StorageToolEvent): Promise<void>;
  loadEvents(roomId: string, limit?: number): Promise<StorageToolEvent[]>;

  // Experience operations
  listExperiences(userId?: string): Promise<ExperienceListing[]>;

  // User profile operations (optional - only for auth-enabled adapters)
  saveUserProfile?(userId: string, profile: any): Promise<void>;
  loadUserProfile?(userId: string): Promise<any | null>;
}

/**
 * In-memory storage adapter
 * No persistence - data lost on restart
 * Perfect for local development and demos
 */
export class InMemoryAdapter implements StorageAdapter {
  private roomStates = new Map<string, RoomState>();
  private events = new Map<string, StorageToolEvent[]>();
  private profiles = new Map<string, any>();

  async saveRoomState(roomId: string, state: RoomState): Promise<void> {
    this.roomStates.set(roomId, state);
  }

  async loadRoomState(roomId: string): Promise<RoomState | null> {
    return this.roomStates.get(roomId) || null;
  }

  async appendEvent(roomId: string, event: StorageToolEvent): Promise<void> {
    if (!this.events.has(roomId)) {
      this.events.set(roomId, []);
    }
    this.events.get(roomId)!.push(event);
  }

  async loadEvents(roomId: string, limit?: number): Promise<StorageToolEvent[]> {
    const events = this.events.get(roomId) || [];
    if (limit) {
      return events.slice(-limit);
    }
    return events;
  }

  async listExperiences(_userId?: string): Promise<ExperienceListing[]> {
    // In-memory mode only returns built-in experiences
    // These will be loaded from the local filesystem registry
    return [];
  }

  async saveUserProfile(userId: string, profile: any): Promise<void> {
    this.profiles.set(userId, profile);
  }

  async loadUserProfile(userId: string): Promise<any | null> {
    return this.profiles.get(userId) || null;
  }
}

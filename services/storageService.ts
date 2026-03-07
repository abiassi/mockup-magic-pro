import { MockupResult, ArtworkLibraryItem, SourcePhotoLibraryItem } from '../types';

const DB_NAME = 'mockup-magic-storage';
const DB_VERSION = 3;
const STORE_NAME = 'mockup-results';
const ARTWORK_STORE_NAME = 'artwork-library';
const SOURCE_PHOTO_STORE_NAME = 'source-photo-library';

class StorageService {
  private db: IDBDatabase | null = null;

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  private putItem<T>(storeName: string, item: T): Promise<void> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private loadAll<T>(storeName: string): Promise<T[]> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev');

      const items: T[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          resolve(items);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  private deleteItem(storeName: string, id: string): Promise<void> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private clearStore(storeName: string): Promise<void> {
    const db = this.requireDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          // Create index on createdAt for sorting
          store.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('Created object store:', STORE_NAME);
        }

        // Create artwork library store if it doesn't exist
        if (!db.objectStoreNames.contains(ARTWORK_STORE_NAME)) {
          const artworkStore = db.createObjectStore(ARTWORK_STORE_NAME, { keyPath: 'id' });
          artworkStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('Created object store:', ARTWORK_STORE_NAME);
        }

        // Create source photo library store if it doesn't exist
        if (!db.objectStoreNames.contains(SOURCE_PHOTO_STORE_NAME)) {
          const sourcePhotoStore = db.createObjectStore(SOURCE_PHOTO_STORE_NAME, { keyPath: 'id' });
          sourcePhotoStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('Created object store:', SOURCE_PHOTO_STORE_NAME);
        }
      };
    });
  }

  /**
   * Save a single mockup result
   */
  async saveResult(result: MockupResult): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(result);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save multiple mockup results at once
   */
  async saveResults(results: MockupResult[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    if (results.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const result of results) {
        store.put(result);
      }
    });
  }

  /**
   * Load all mockup results, sorted by creation date (newest first)
   */
  async loadAllResults(): Promise<MockupResult[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev'); // 'prev' = descending order

      const results: MockupResult[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a specific result by ID
   */
  async deleteResult(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all stored results
   */
  async clearAll(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('All results cleared from storage');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{ count: number; estimatedSizeKB: number }> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const results = await this.loadAllResults();
    const count = results.length;

    // Rough estimate: sum of image data lengths
    let totalBytes = 0;
    for (const result of results) {
      // Base64 image data is roughly 1.33x the actual size
      totalBytes += result.imageUrl.length / 1.33;
    }

    return {
      count,
      estimatedSizeKB: Math.round(totalBytes / 1024)
    };
  }

  /**
   * Export all results to JSON for backup
   */
  async exportToJSON(): Promise<string> {
    const results = await this.loadAllResults();
    return JSON.stringify(results, null, 2);
  }

  /**
   * Import results from JSON backup
   */
  async importFromJSON(jsonString: string): Promise<number> {
    try {
      const results: MockupResult[] = JSON.parse(jsonString);

      // Validate the data structure
      if (!Array.isArray(results)) {
        throw new Error('Invalid data format: expected an array');
      }

      // Basic validation of each result
      for (const result of results) {
        if (!result.id || !result.imageUrl || !result.prompt) {
          throw new Error('Invalid result format: missing required fields');
        }
      }

      await this.saveResults(results);
      return results.length;
    } catch (error) {
      console.error('Import failed:', error);
      throw error;
    }
  }

  // --- Artwork Library Methods ---

  /** Save a single artwork to the library */
  async saveArtwork(artwork: ArtworkLibraryItem): Promise<void> {
    return this.putItem(ARTWORK_STORE_NAME, artwork);
  }

  /** Load all artworks from the library, sorted by creation date (newest first) */
  async loadAllArtwork(): Promise<ArtworkLibraryItem[]> {
    return this.loadAll<ArtworkLibraryItem>(ARTWORK_STORE_NAME);
  }

  /** Delete a specific artwork from the library */
  async deleteArtwork(id: string): Promise<void> {
    return this.deleteItem(ARTWORK_STORE_NAME, id);
  }

  /** Clear all artworks from the library */
  async clearAllArtwork(): Promise<void> {
    return this.clearStore(ARTWORK_STORE_NAME);
  }

  // --- Source Photo Library Methods ---

  /** Save a single source photo to the library */
  async saveSourcePhoto(photo: SourcePhotoLibraryItem): Promise<void> {
    return this.putItem(SOURCE_PHOTO_STORE_NAME, photo);
  }

  /** Load all source photos, sorted by creation date (newest first) */
  async loadAllSourcePhotos(): Promise<SourcePhotoLibraryItem[]> {
    return this.loadAll<SourcePhotoLibraryItem>(SOURCE_PHOTO_STORE_NAME);
  }

  /** Delete a specific source photo from the library */
  async deleteSourcePhoto(id: string): Promise<void> {
    return this.deleteItem(SOURCE_PHOTO_STORE_NAME, id);
  }

  /** Clear all source photos from the library */
  async clearAllSourcePhotos(): Promise<void> {
    return this.clearStore(SOURCE_PHOTO_STORE_NAME);
  }
}

// Export singleton instance
export const storageService = new StorageService();

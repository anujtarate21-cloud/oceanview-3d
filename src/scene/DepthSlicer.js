import { loadModelData, generateSyntheticTile } from '../utils/dataLoader.js';

/**
 * DepthSlicer manager for handling depth clipping and slice navigation.
 */
export class DepthSlicer {
  /**
   * Initializes DepthSlicer controller.
   * @param {VolumeRenderer} volumeRenderer Active VolumeRenderer instance
   */
  constructor(volumeRenderer) {
    this.volumeRenderer = volumeRenderer;
    this.currentDepth = 0;
    this.availableDepths = [0, 50, 100, 200, 500];
  }

  /**
   * Updates list of available depth levels from metadata.
   * @param {Array<number>} depths
   */
  setAvailableDepths(depths) {
    if (Array.isArray(depths) && depths.length > 0) {
      this.availableDepths = depths;
    }
  }

  /**
   * Navigates to target depth and updates VolumeRenderer slice.
   * @param {number} depth Depth level in meters
   * @param {string} [variable] Active ocean variable
   * @param {number} [timestep] Active timestep index
   * @returns {Promise<Object|null>} Loaded tile data
   */
  async setDepth(depth, variable = 'temperature', timestep = 0) {
    this.currentDepth = depth;
    try {
      let tile = await loadModelData(variable, depth, timestep);
      if (!tile) {
        tile = generateSyntheticTile(variable, depth);
      }
      if (tile) {
        if (typeof this.volumeRenderer.loadDepthSlice === 'function') {
          this.volumeRenderer.loadDepthSlice(tile);
        } else if (typeof this.volumeRenderer.updateDepth === 'function') {
          this.volumeRenderer.updateDepth(tile);
        }
        return tile;
      }
    } catch (err) {
      console.error(`DepthSlicer failed to load depth ${depth}m:`, err);
    }
    return null;
  }

  /**
   * Returns current active depth level.
   * @returns {number}
   */
  getCurrentDepth() {
    return this.currentDepth;
  }
}

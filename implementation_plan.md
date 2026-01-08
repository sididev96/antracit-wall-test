# Depth-Based Wall Visualizer Implementation Plan

## Goal Description

Replace the current manual point-based and SAM-based wall detection system with a new logical AI approach using **Local Depth Detection**. The goal is to allow users to visualize `panel.png` and `panel2.png` on their walls by utilizing depth maps to handle occlusion (objects in front of the wall) and potentially wall plane detection.
We will use `@huggingface/transformers` with the `depth-anything-small-hf` model running entirely in the browser (local AI).

## ✅ Implementation Status: COMPLETED

## User Review Required

> [!IMPORTANT]
> This change completely removes the previous "Point Based" and "Auto Detection" (SAM) modes.

## Completed Changes

### System

#### [DONE] Dependency

- Added `@huggingface/transformers` to `package.json`.

### Components

#### [DONE] [Visualizer.tsx](file:///src/components/Visualizer.tsx)

- Removed existing state machine for point-selection/SAM.
- Implemented new flow:
  1.  **Image Upload**: (Reused existing upload UI).
  2.  **Depth Estimation**: On upload, runs `depth-anything` model to generate a depth tensor/canvas.
  3.  **Visualization Interface**:
      - Shows the uploaded image.
      - Allows user to select a panel.
      - **Interaction**: User clicks on the wall to sample depth.
      - **Rendering**: Uses depth-based masking for occlusion handling.
      - Added depth threshold slider for fine-tuning.
      - Added depth map preview for debugging.

#### [DONE] Legacy Components Removed

- Deleted `src/components/WallSelector.tsx` (Old polygon tool).

#### [DONE] [DepthService.ts](file:///src/lib/depthService.ts)

- Created singleton service to load `Xenova/depth-anything-small-hf`.
- Functions: `estimateDepth(imageUrl) -> DepthMapResult`, `sampleDepthAt()`, etc.

#### [DONE] [textureUtils.ts](file:///src/lib/textureUtils.ts)

- Added `applyTextureWithDepthMask()` function for depth-based visualization.

## Verification Plan

### Automated Tests

- None (Visualizer changes are heavily visual/interactive).

### Manual Verification

1.  **Setup**: `npm install`, `npm run dev`.
2.  Upload an image of a room with furniture/objects in front of walls.
3.  Wait for depth analysis to complete (first run downloads ~45MB model).
4.  Click on a wall area to select target depth.
5.  Adjust depth sensitivity slider if needed.
6.  Select a panel and apply visualization.
7.  Verify that foreground objects (furniture, people) remain visible while wall gets textured.

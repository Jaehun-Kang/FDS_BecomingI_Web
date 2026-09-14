import { useCallback, useEffect, useRef, useState } from "react";
import { isTransitionVisible } from "../services/transitionVisibility.js";
import { logProfileTiming, createPlaybackContext } from "../experiments/performanceLog.js";
import iconPostsO from "../assets/icons/posts_outline.svg";
import iconPostsS from "../assets/icons/posts_solid.svg";
import iconPostsTaggedO from "../assets/icons/posts_tagged_outline.svg";
import iconPostsTaggedS from "../assets/icons/posts_tagged_solid.svg";
import iconClose from "../assets/icons/close.svg";
import iconHeartO from "../assets/icons/heart_outline.svg";
import iconHeartS from "../assets/icons/heart_solid.svg";
import PostFrame from "./PostFrame";
import { useProfileTransforms } from "../hooks/useProfileTransforms.js";
import { useNavigate } from "react-router-dom";
import { getCurrentAudience } from "../utils/audienceStore.js";
import { socialStore } from "../services/socialStore.js";
import { getTaggedPosts, getPostTransformAssetId, updatePostLike, lockPageScroll } from "../services/postInteractions.js";
import { createTransitionQueue } from "../services/transitionQueue.js";
import { createPreparationCache } from "../services/preparationCache.js";
import { getCanvasBackingGeometry } from "../services/canvasGeometry.js";
import { getPostOverlayRatio, getPostOverlayWidth } from "../services/postOverlayGeometry.js";
import { createProfileWorkers } from "../services/profileWorkers.js";
import { getResultGrid } from "../experiments/transformSettings.js";

const profileAssetUrls = import.meta.glob("../assets/**/*", {
  eager: true,
  import: "default",
  query: "?url",
});
const postFrameCount = 80;

const resolveAssetUrl = (path) => profileAssetUrls[path] ?? path;

const getInitialStats = (profileData) => ({
  posts: profileData.posts.length,
  followers: profileData.stats?.followers ?? 0,
  following: profileData.stats?.following ?? 0,
});

const getProfileGenderByUsername = (username) => {
  if (username === "jin.d0uble0") return "male";
  if (username === "we_r_0") return "female";
  return null;
};

const getPostDate = (timestamp) => {
  const timestampText = String(timestamp);
  const year = Number(timestampText.slice(0, 4));
  const month = Number(timestampText.slice(4, 6)) - 1;
  const date = Number(timestampText.slice(6, 8));

  return new Date(year, month, date);
};

const formatPostTimestamp = (timestamp) => {
  const postDate = getPostDate(timestamp);
  const year = postDate.getFullYear();
  const month = String(postDate.getMonth() + 1).padStart(2, "0");
  const date = String(postDate.getDate()).padStart(2, "0");

  return `${year}년 ${month}월 ${date}일`;
};

const getRelativePostTimestamp = (timestamp) => {
  const currentDate = new Date();
  const postDate = getPostDate(timestamp);
  const elapsedDays = Math.max(
    0,
    Math.floor((currentDate - postDate) / (1000 * 60 * 60 * 24)),
  );

  if (elapsedDays === 0) {
    return "오늘";
  }

  if (elapsedDays < 7) {
    return `${elapsedDays}일`;
  }

  return `${Math.floor(elapsedDays / 7)}주`;
};


const avatarImageStyle = {
  height: "100%",
  objectFit: "cover",
  width: "100%",
};
const profileAvatarStyle = {
  height: "150px",
  objectFit: "cover",
  width: "150px",
};
const profileFaceBoxes = {
  female: {
    x: 0.1705223673582077,
    y: 0.10062859058380126,
    width: 0.6642894339561463,
    height: 0.5984634637832642,
  },
  male: {
    x: 0.16394871473312378,
    y: 0.1559463620185852,
    width: 0.6768743991851807,
    height: 0.6345608770847321,
  },
};
const profileTransitionSidelen = 128;
const faceOutlineIndices = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];
const faceHoleIndices = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385,
    384, 398,
  ],
  [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317,
    14, 87, 178, 88, 95,
  ],
];

const getProfileAssetId = (profileGender) =>
  profileGender === "female" ? "female-profile" : "male-profile";

const loadCanvasImage = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Profile image load failed: ${source}`));
    image.src = source;
  });

const getPixelBox = (box, width, height) => {
  const x = Math.max(0, Math.floor(box.x * width));
  const y = Math.max(0, Math.floor(box.y * height));
  const right = Math.min(width, Math.ceil((box.x + box.width) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
  return { x, y, width: right - x, height: bottom - y };
};

const traceLandmarkPath = (
  context,
  indexes,
  landmarks,
  coverMetrics,
  sourceWidth,
  sourceHeight,
) => {
  const points = indexes
    .map((index) => landmarks[index])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({
      x: coverMetrics.x + point.x * coverMetrics.width,
      y: coverMetrics.y + point.y * coverMetrics.height,
    }));

  if (points.length < 3 || !sourceWidth || !sourceHeight) {
    return false;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  return true;
};

const drawFallbackFaceMask = (context, viewportX, viewportY, viewportW, viewportH) => {
  context.beginPath();
  context.ellipse(
    viewportX + viewportW / 2,
    viewportY + viewportH / 2,
    viewportW / 2,
    viewportH / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
};

const drawLandmarkFaceMask = ({
  context,
  coverMetrics,
  faceLandmarks,
  sourceWidth,
  sourceHeight,
  viewportH,
  viewportW,
  viewportX,
  viewportY,
}) => {
  if (
    !Array.isArray(faceLandmarks) ||
    !traceLandmarkPath(
      context,
      faceOutlineIndices,
      faceLandmarks,
      coverMetrics,
      sourceWidth,
      sourceHeight,
    )
  ) {
    drawFallbackFaceMask(context, viewportX, viewportY, viewportW, viewportH);
    return;
  }

  context.fill();
  context.globalCompositeOperation = "destination-out";
  for (const hole of faceHoleIndices) {
    if (
      traceLandmarkPath(
        context,
        hole,
        faceLandmarks,
        coverMetrics,
        sourceWidth,
        sourceHeight,
      )
    ) {
      context.fill();
    }
  }
  context.globalCompositeOperation = "source-over";
};

const parseCssPixelValue = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeObjectFit = (value) => {
  const normalized = String(value || "fill")
    .trim()
    .toLowerCase();
  if (
    normalized === "contain" ||
    normalized === "cover" ||
    normalized === "none" ||
    normalized === "scale-down"
  ) {
    return normalized;
  }
  return "fill";
};

const isHorizontalPositionKeyword = (token) =>
  token === "left" || token === "center" || token === "right";

const isVerticalPositionKeyword = (token) =>
  token === "top" || token === "center" || token === "bottom";

const parseObjectPosition = (value) => {
  const tokens = String(value || "50% 50%")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) {
    return { x: "50%", y: "50%" };
  }

  if (tokens.length === 1) {
    return isVerticalPositionKeyword(tokens[0])
      ? { x: "50%", y: tokens[0] }
      : { x: tokens[0], y: "50%" };
  }

  if (
    isVerticalPositionKeyword(tokens[0]) &&
    isHorizontalPositionKeyword(tokens[1])
  ) {
    return { x: tokens[1], y: tokens[0] };
  }

  return { x: tokens[0], y: tokens[1] };
};

const resolveObjectPositionOffset = (token, freeSpace) => {
  const normalized = String(token || "50%")
    .trim()
    .toLowerCase();
  if (normalized === "left" || normalized === "top") return 0;
  if (normalized === "right" || normalized === "bottom") return freeSpace;
  if (normalized === "center") return freeSpace * 0.5;
  if (normalized.endsWith("%")) {
    const percent = Number.parseFloat(normalized);
    return Number.isFinite(percent)
      ? (freeSpace * percent) / 100
      : freeSpace * 0.5;
  }

  const px = Number.parseFloat(normalized);
  return Number.isFinite(px) ? px : freeSpace * 0.5;
};

const resolveConcreteObjectSize = (
  objectFit,
  sourceWidth,
  sourceHeight,
  contentWidth,
  contentHeight,
) => {
  const safeSourceWidth = Math.max(1, sourceWidth || contentWidth);
  const safeSourceHeight = Math.max(1, sourceHeight || contentHeight);
  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const contentAspect = contentWidth / Math.max(1, contentHeight);

  if (objectFit === "none") {
    return { width: safeSourceWidth, height: safeSourceHeight };
  }

  if (objectFit === "contain") {
    if (sourceAspect > contentAspect) {
      return {
        width: contentWidth,
        height: contentWidth / Math.max(sourceAspect, 1e-6),
      };
    }
    return {
      width: contentHeight * sourceAspect,
      height: contentHeight,
    };
  }

  if (objectFit === "cover") {
    if (sourceAspect > contentAspect) {
      return {
        width: contentHeight * sourceAspect,
        height: contentHeight,
      };
    }
    return {
      width: contentWidth,
      height: contentWidth / Math.max(sourceAspect, 1e-6),
    };
  }

  if (objectFit === "scale-down") {
    const containSize = resolveConcreteObjectSize(
      "contain",
      safeSourceWidth,
      safeSourceHeight,
      contentWidth,
      contentHeight,
    );
    if (
      containSize.width < safeSourceWidth ||
      containSize.height < safeSourceHeight
    ) {
      return containSize;
    }
    return { width: safeSourceWidth, height: safeSourceHeight };
  }

  return { width: contentWidth, height: contentHeight };
};

const getDisplayedImageMetrics = (
  imageElement,
  pixelBox,
  sourceWidth,
  sourceHeight,
  fallbackDisplayWidth,
  fallbackDisplayHeight,
) => {
  const rect = imageElement.getBoundingClientRect();
  const computedStyle = getComputedStyle(imageElement);
  const borderLeft = parseCssPixelValue(computedStyle.borderLeftWidth);
  const borderRight = parseCssPixelValue(computedStyle.borderRightWidth);
  const borderTop = parseCssPixelValue(computedStyle.borderTopWidth);
  const borderBottom = parseCssPixelValue(computedStyle.borderBottomWidth);
  const paddingLeft = parseCssPixelValue(computedStyle.paddingLeft);
  const paddingRight = parseCssPixelValue(computedStyle.paddingRight);
  const paddingTop = parseCssPixelValue(computedStyle.paddingTop);
  const paddingBottom = parseCssPixelValue(computedStyle.paddingBottom);
  const renderWidth = Math.max(
    1,
    rect.width || imageElement.clientWidth || fallbackDisplayWidth,
  );
  const renderHeight = Math.max(
    1,
    rect.height || imageElement.clientHeight || fallbackDisplayHeight,
  );
  const contentWidth = Math.max(
    1,
    renderWidth - borderLeft - borderRight - paddingLeft - paddingRight,
  );
  const contentHeight = Math.max(
    1,
    renderHeight - borderTop - borderBottom - paddingTop - paddingBottom,
  );
  const objectFit = normalizeObjectFit(computedStyle.objectFit);
  const objectPosition = parseObjectPosition(computedStyle.objectPosition);
  const concreteSize = resolveConcreteObjectSize(
    objectFit,
    sourceWidth,
    sourceHeight,
    contentWidth,
    contentHeight,
  );
  const freeX = contentWidth - concreteSize.width;
  const freeY = contentHeight - concreteSize.height;
  const drawLeft =
    borderLeft +
    paddingLeft +
    resolveObjectPositionOffset(objectPosition.x, freeX);
  const drawTop =
    borderTop +
    paddingTop +
    resolveObjectPositionOffset(objectPosition.y, freeY);
  const scaleX = concreteSize.width / Math.max(1, sourceWidth);
  const scaleY = concreteSize.height / Math.max(1, sourceHeight);

  return {
    renderWidth,
    renderHeight,
    drawLeft,
    drawTop,
    scaleX,
    scaleY,
    faceX: drawLeft + pixelBox.x * scaleX,
    faceY: drawTop + pixelBox.y * scaleY,
    faceWidth: Math.max(1, pixelBox.width * scaleX),
    faceHeight: Math.max(1, pixelBox.height * scaleY),
  };
};

const drawImageCoverForAspect = (context, image, width, height, aspect) => {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const sourceAspect = imageWidth / imageHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imageWidth;
  let sourceHeight = imageHeight;

  if (sourceAspect > aspect) {
    sourceWidth = sourceHeight * aspect;
    sourceX = (imageWidth - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / aspect;
    sourceY = (imageHeight - sourceHeight) / 2;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
};

const cropImage = (image, box) => {
  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas
    .getContext("2d")
    .drawImage(
      image,
      box.x,
      box.y,
      box.width,
      box.height,
      0,
      0,
      box.width,
      box.height,
    );
  return canvas;
};

const imageRgb = (canvas, aspect, gridWidth = profileTransitionSidelen, gridHeight = gridWidth) => {
  const output = new OffscreenCanvas(
    gridWidth,
    gridHeight,
  );
  const context = output.getContext("2d");
  drawImageCoverForAspect(
    context,
    canvas,
    gridWidth,
    gridHeight,
    aspect,
  );
  const rgba = context.getImageData(
    0,
    0,
    gridWidth,
    gridHeight,
  ).data;
  const rgb = new Uint8Array(
    gridWidth * gridHeight * 3,
  );
  for (let index = 0; index < gridWidth * gridHeight; index += 1) {
    rgb[index * 3] = rgba[index * 4];
    rgb[index * 3 + 1] = rgba[index * 4 + 1];
    rgb[index * 3 + 2] = rgba[index * 4 + 2];
  }
  return rgb;
};

const imageGray = (image, aspect, gridWidth = profileTransitionSidelen, gridHeight = gridWidth) => {
  const canvas = new OffscreenCanvas(
    gridWidth,
    gridHeight,
  );
  const context = canvas.getContext("2d");
  drawImageCoverForAspect(
    context,
    image,
    gridWidth,
    gridHeight,
    aspect,
  );
  const rgba = context.getImageData(
    0,
    0,
    gridWidth,
    gridHeight,
  ).data;
  return Uint8Array.from(
    { length: gridWidth * gridHeight },
    (_, index) => rgba[index * 4],
  );
};

const buildPreviewPremultipliedRgba = (srcRgba) => {
  const rgba = srcRgba.slice();
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    rgba[index] = Math.round(rgba[index] * alpha);
    rgba[index + 1] = Math.round(rgba[index + 1] * alpha);
    rgba[index + 2] = Math.round(rgba[index + 2] * alpha);
  }
  return rgba;
};

const buildMaskedFaceSourceRgba = (
  sourceImage,
  pixelBox,
  renderW,
  renderH,
  processingSidelen,
  aspect,
  targetMaskCanvas,
  gridHeight = processingSidelen,
) => {
  const sourceCanvas = new OffscreenCanvas(renderW, renderH);
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    return null;
  }

  sourceContext.drawImage(
    sourceImage,
    pixelBox.x,
    pixelBox.y,
    pixelBox.width,
    pixelBox.height,
    0,
    0,
    renderW,
    renderH,
  );
  sourceContext.globalCompositeOperation = "destination-in";
  sourceContext.drawImage(targetMaskCanvas, 0, 0, renderW, renderH);
  sourceContext.globalCompositeOperation = "source-over";

  const output = new OffscreenCanvas(processingSidelen, gridHeight);
  const context = output.getContext("2d");
  drawImageCoverForAspect(
    context,
    sourceCanvas,
    processingSidelen,
    gridHeight,
    aspect,
  );
  return new Uint8Array(
    context.getImageData(0, 0, processingSidelen, gridHeight).data.buffer,
  );
};

const profileWorkers = createProfileWorkers({
  createWorker: (role) => new Worker("/v2/resources/transform/obamify-worker.js?v=profile-transition-11", {
    name: "bi-profile-" + role,
  }),
  loadResources: async () => {
    const [wasmJsSource, wasmBytes, weightsImage, seed, jfa, shade] =
      await Promise.all([
        fetch("/v2/resources/transform/pkg/obamify_wasm.js").then((response) =>
          response.text(),
        ),
        fetch("/v2/resources/transform/pkg/obamify_wasm_bg.wasm").then(
          (response) => response.arrayBuffer(),
        ),
        loadCanvasImage("/v2/resources/transform/weights256.png"),
        fetch("/v2/resources/transform/seed.wgsl").then((response) =>
          response.text(),
        ),
        fetch("/v2/resources/transform/jfa.wgsl").then((response) =>
          response.text(),
        ),
        fetch("/v2/resources/transform/shade.wgsl").then((response) =>
          response.text(),
        ),
      ]);

    return {
      weightsImage,
      init: {
        wasmJsSource,
        wasmBytes,
        targetRgb: new Uint8Array(profileTransitionSidelen ** 2 * 3),
        weightsGray: new Uint8Array(profileTransitionSidelen ** 2),
        shaderSources: { seed, jfa, shade },
      },
    };
  },
});
const getProfileTransitionWorker = () => profileWorkers.get("animation");

let nextProfileTransitionJobId = 1;
const completedProfileTransitionCache = new Set();

const getProfileTransitionKey = (baseSrc, src) => `${baseSrc}::${src || ""}`;
const markProfileTransitionComplete = (baseSrc, src) => {
  if (src && src !== baseSrc) {
    completedProfileTransitionCache.add(getProfileTransitionKey(baseSrc, src));
  }
};
const enqueueProfileTransition = createTransitionQueue(4);
const enqueueProfilePreparation = createTransitionQueue(1);
const getPreparedProfile = createPreparationCache();

const prepareProfilePixelTransition = async ({ baseSrc, src, faceBox, assetId, timingContext }) => {
  const startedAt = performance.now();
  getProfileTransitionWorker().catch((error) => {
    console.warn("[BI] Profile animation worker warmup failed", error);
  });
  const [{ worker, weightsImage }, fromImage, toImage] = await Promise.all([
    profileWorkers.get("compute"), loadCanvasImage(baseSrc), loadCanvasImage(src),
  ]);
  const decodedAt = performance.now();
  const box = getPixelBox(faceBox, fromImage.naturalWidth, fromImage.naturalHeight);
  const aspect = box.width / box.height;
  const { sidelen, gridWidth, gridHeight } = getResultGrid(src, box.width, box.height);
  const targetCrop = cropImage(toImage, box);
  const sourceRgba = buildMaskedFaceSourceRgba(fromImage, box, box.width, box.height,
    gridWidth, aspect, targetCrop, gridHeight);
  if (!sourceRgba) throw new Error("Profile masked source canvas unavailable");
  const targetRgb = imageRgb(targetCrop, aspect, gridWidth, gridHeight);
  const weightsGray = imageGray(weightsImage, aspect, gridWidth, gridHeight);
  const imgId = nextProfileTransitionJobId++;
  const preparedAt = performance.now();
  const computeStartedAt = performance.now();
  const logPreparation = (workerPerf, workerRoundTripMs) => logProfileTiming("[BI] Profile preparation timing", {
    ...timingContext, assetId, imgId,
    decodeAndWorkerMs: decodedAt - startedAt,
    inputPreparationMs: preparedAt - decodedAt,
    cacheStatus: "disabled",
    cacheLookupMs: 0,
    workerRoundTripMs,
    totalMs: performance.now() - startedAt,
    worker: workerPerf,
  });
  const assignments = await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
    };
    const onMessage = (event) => {
      if (event.data.imgId !== imgId) return;
      if (event.data.type === "COMPUTE_DONE") {
        logPreparation(event.data.perf, performance.now() - computeStartedAt);
        cleanup();
        resolve(event.data.assignments);
      } else if (event.data.type === "ERROR") {
        cleanup();
        reject(new Error(event.data.error));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Profile transition preparation timed out"));
    }, 120000);
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "PROCESS", imgId, prepareOnly: true,
      sourceType: "img", sidelen, gridWidth, gridHeight,
      srcRgba: sourceRgba.buffer, targetRgb: targetRgb.buffer, weightsGray: weightsGray.buffer });
  });
  return { assignments, sourceRgba, targetRgb, weightsGray, sidelen, gridWidth, gridHeight };
};

const isElementReadyForTransition = (element) => {
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;

  return isTransitionVisible(element, viewportWidth, viewportHeight);
};

const getElementViewportRatio = (element) => {
  const rect = element?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return 0;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  const visibleWidth = Math.max(
    0,
    Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
  );
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
  );

  return (visibleWidth * visibleHeight) / (rect.width * rect.height);
};

const runProfilePixelTransition = async ({
  timingContext,
  assetId,
  baseSrc,
  container,
  faceBox,
  faceLandmarks,
  imageElement,
  onFirstFrame,
  src,
  prepared,
}) => {
  console.info("[BI] Profile pixel transition start", {
    hasFaceBox: Boolean(faceBox),
    hasFaceLandmarks: Array.isArray(faceLandmarks),
  });
  const [{ worker, weightsImage }, fromImage, toImage] = await Promise.all([
    getProfileTransitionWorker(),
    loadCanvasImage(baseSrc),
    prepared ? Promise.resolve(null) : loadCanvasImage(src),
  ]);
  const sourceBox = getPixelBox(
    faceBox,
    fromImage.naturalWidth,
    fromImage.naturalHeight,
  );
  const displayMetrics = getDisplayedImageMetrics(
    imageElement,
    sourceBox,
    fromImage.naturalWidth,
    fromImage.naturalHeight,
    container.clientWidth,
    container.clientHeight,
  );
  const displayRenderWidth = displayMetrics.renderWidth;
  const displayRenderHeight = displayMetrics.renderHeight;
  const targetCrop = prepared ? null : cropImage(toImage, sourceBox);
  const aspect = sourceBox.width / sourceBox.height;
  const backingScale = Math.max(
    1,
    Math.min(
      4,
      Math.ceil(
        Math.max(
          sourceBox.width / Math.max(1, displayRenderWidth),
          sourceBox.height / Math.max(1, displayRenderHeight),
          window.devicePixelRatio || 1,
        ),
      ),
    ),
  );
  const { renderWidth, renderHeight, scaleX: backingScaleX, scaleY: backingScaleY } =
    getCanvasBackingGeometry(displayRenderWidth, displayRenderHeight, backingScale);
  const sourceRgba = prepared?.sourceRgba ?? buildMaskedFaceSourceRgba(
    fromImage,
    sourceBox,
    sourceBox.width,
    sourceBox.height,
    profileTransitionSidelen,
    aspect,
    targetCrop,
  );
  if (!sourceRgba) {
    throw new Error("Profile masked source canvas unavailable");
  }
  const renderSrcRgba = buildPreviewPremultipliedRgba(sourceRgba);
  const targetRgb = prepared?.targetRgb ?? imageRgb(targetCrop, aspect);
  const weightsGray = prepared?.weightsGray ?? imageGray(weightsImage, aspect);
  const viewportX = displayMetrics.faceX * backingScaleX;
  const viewportY = displayMetrics.faceY * backingScaleY;
  const viewportW = Math.max(1, displayMetrics.faceWidth * backingScaleX);
  const viewportH = Math.max(1, displayMetrics.faceHeight * backingScaleY);
  const canvas = document.createElement("canvas");
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  canvas.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "display:block",
    "pointer-events:none",
    "opacity:1",
    "z-index:3",
    "transition:opacity 140ms ease",
    "visibility:hidden",
  ].join(";");
  container.appendChild(canvas);
  console.info("[BI] Profile pixel transition canvas mounted", {
    renderWidth,
    renderHeight,
    backingScale,
    backingScaleX,
    backingScaleY,
    viewportX,
    viewportY,
    viewportW,
    viewportH,
  });

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = renderWidth;
  maskCanvas.height = renderHeight;
  const maskContext = maskCanvas.getContext("2d");
  maskContext.fillStyle = "white";
  const coverMetrics = {
    x: displayMetrics.drawLeft * backingScaleX,
    y: displayMetrics.drawTop * backingScaleY,
    width: fromImage.naturalWidth * displayMetrics.scaleX * backingScaleX,
    height: fromImage.naturalHeight * displayMetrics.scaleY * backingScaleY,
  };
  drawLandmarkFaceMask({
    context: maskContext,
    coverMetrics,
    faceLandmarks,
    sourceWidth: fromImage.naturalWidth,
    sourceHeight: fromImage.naturalHeight,
    viewportX,
    viewportY,
    viewportW,
    viewportH,
  });
  const maskUrl = maskCanvas.toDataURL("image/png");
  canvas.style.maskImage = `url(${maskUrl})`;
  canvas.style.maskMode = "alpha";
  canvas.style.maskSize = "100% 100%";
  canvas.style.maskRepeat = "no-repeat";
  canvas.style.webkitMaskImage = `url(${maskUrl})`;
  canvas.style.webkitMaskMode = "alpha";
  canvas.style.webkitMaskSize = "100% 100%";
  canvas.style.webkitMaskRepeat = "no-repeat";

  const offscreen = canvas.transferControlToOffscreen();
  const imgId = nextProfileTransitionJobId++;
  const playbackRequestedAt = performance.now();

  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data.imgId !== imgId) return;

      if (event.data.type === "FIRST_FRAME") {
        logProfileTiming("[BI] Profile first frame timing", {
          ...timingContext,
          assetId,
          imgId,
          playbackToFirstFrameMs: performance.now() - playbackRequestedAt,
          worker: event.data.perf,
        });
        canvas.style.visibility = "visible";
        onFirstFrame?.();
      }

      if (event.data.type === "PERF_SUMMARY") {
        logProfileTiming("[BI] Profile animation timing", { ...timingContext, assetId, imgId, ...event.data.perf });
      }

      if (event.data.type === "ANIMATION_DONE") {
        worker.removeEventListener("message", onMessage);
        logProfileTiming("[BI] Profile pixel transition complete", { ...timingContext, assetId, imgId, finishReason: event.data.finishReason });
        resolve({
          finishReason: event.data.finishReason ?? "worker-completed-unspecified",
          cleanup: () => {
            canvas.style.opacity = "0";
            window.setTimeout(() => canvas.remove(), 160);
          },
        });
      }

      if (event.data.type === "ERROR") {
        worker.removeEventListener("message", onMessage);
        canvas.remove();
        reject(new Error(event.data.error || "Profile transition failed"));
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage(
      {
        type: "PROCESS",
        imgId,
        sourceType: "img",
        directFinalize: false,
        exportFinalImage: false,
        assignments: prepared?.assignments,
        sidelen: profileTransitionSidelen,
        ...(prepared ? { sidelen: prepared.sidelen, gridWidth: prepared.gridWidth, gridHeight: prepared.gridHeight } : {}),
        srcRgba: sourceRgba.buffer,
        renderSrcRgba: renderSrcRgba.buffer,
        targetRgb: targetRgb.buffer,
        weightsGray: weightsGray.buffer,
        renderW: renderWidth,
        renderH: renderHeight,
        viewportX,
        viewportY,
        viewportW,
        viewportH,
        motionScale: 1.8,
        renderFps: 60,
        offscreen,
      },
      [
        offscreen,
      ],
    );
  });
};

function ProfileTransformAvatar({
  alt,
  assetId,
  baseSrc,
  className,
  faceBox,
  faceLandmarks,
  imageStyle,
  onLoad,
  onVisibleAsset,
  replayTransition = false,
  src,
  style,
}) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const transitionKeyRef = useRef(null);
  const faceBoxRef = useRef(faceBox);
  const faceLandmarksRef = useRef(faceLandmarks);
  const transformedImageRef = useRef(null);
  const replayTransitionRef = useRef(replayTransition);
  const initialTransitionKey = getProfileTransitionKey(baseSrc, src);
  const initialHasCompletedTransition =
    !replayTransition &&
    src &&
    src !== baseSrc &&
    completedProfileTransitionCache.has(initialTransitionKey);
  const [committedSrc, setCommittedSrc] = useState(
    initialHasCompletedTransition ? src : null,
  );
  const [showTransformedImage, setShowTransformedImage] = useState(
    false,
  );

  useEffect(() => {
    transitionKeyRef.current = null;
    setCommittedSrc(null);
    setShowTransformedImage(false);
  }, [baseSrc]);

  useEffect(() => {
    faceBoxRef.current = faceBox;
    faceLandmarksRef.current = faceLandmarks;
    replayTransitionRef.current = replayTransition;
  }, [faceBox, faceLandmarks, replayTransition]);

  useEffect(() => {
    if (!assetId || !onVisibleAsset) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const visibilityTarget =
      container.closest(".profile--posts--frames--frame") ?? container;
    return onVisibleAsset(assetId, visibilityTarget);
  }, [assetId, onVisibleAsset]);

  useEffect(() => {
    const container = containerRef.current;
    const imageElement = imageRef.current;
    const transitionKey = getProfileTransitionKey(baseSrc, src);
    const activeFaceBox = faceBoxRef.current;
    const activeFaceLandmarks = faceLandmarksRef.current;
    const prioritizePlayback = replayTransitionRef.current;

    if (
      !container ||
      !imageElement ||
      !src ||
      src === baseSrc ||
      !activeFaceBox ||
      !Array.isArray(activeFaceLandmarks)
    ) {
      return undefined;
    }

    if (completedProfileTransitionCache.has(transitionKey)) {
      transitionKeyRef.current = transitionKey;
      setCommittedSrc(src);
      let active = true;
      transformedImageRef.current.decode().then(() => {
        if (active) setShowTransformedImage(true);
      }).catch(() => {
        // A missing cached blob must never hide the original.
      });
      return () => { active = false; };
    }

    if (transitionKeyRef.current === transitionKey) {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    let cleanupOverlay = null;
    let stage = "preparing";
    const timingContext = createPlaybackContext(src);
    let finished = false;
    const lifecycleStartedAt = performance.now();
    const finish = (finishReason) => {
      if (finished) return;
      finished = true;
      logProfileTiming("[BI] Profile playback ended", {
        ...timingContext,
        assetId, stage, finishReason, totalMs: performance.now() - lifecycleStartedAt,
      });
    };
    transitionKeyRef.current = transitionKey;

    const render = async () => {
      const visibilityTarget =
        container.closest(".profile--posts--frames--frame") ?? container;
      if (cancelled) return null;
      const preparationKey = `${transitionKey}:${JSON.stringify(activeFaceBox)}`;
      const prepared = await (getPreparedProfile.peek(preparationKey) || enqueueProfilePreparation(
        () => getPreparedProfile(preparationKey,
          () => prepareProfilePixelTransition({ baseSrc, src, faceBox: activeFaceBox, assetId, timingContext })),
        { signal: controller.signal, priority: prioritizePlayback ? 1 : 0, ready: () => {
          if (!visibilityTarget.isConnected) return false;
          const rect = visibilityTarget.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
            rect.top <= window.innerHeight + rect.height && rect.right > 0 && rect.left < window.innerWidth;
        } },
      ));
      if (cancelled || !prepared) return null;
      stage = "waiting-for-viewport-and-capacity";
      return enqueueProfileTransition(async () => {
        if (cancelled) return null;
        await transformedImageRef.current?.decode();
        if (cancelled) return null;
        console.info("[BI] Profile pixel transition viewport ready");
        stage = "playing";
        setCommittedSrc(src);
        return runProfilePixelTransition({
          timingContext,
          assetId,
          baseSrc,
          container,
          faceBox: activeFaceBox,
          faceLandmarks: activeFaceLandmarks,
          imageElement,
          src,
          prepared,
        });
      }, { ready: () => isElementReadyForTransition(visibilityTarget), signal: controller.signal,
        priority: prioritizePlayback ? 1 : 0 });
    };

    render()
      .then(async (result) => {
        cleanupOverlay = result?.cleanup || null;
        if (cancelled) { cleanupOverlay?.(); return; }
        if (!result) { finish("not-started"); return; }
        stage = "handoff-to-blob";
        await transformedImageRef.current?.decode();
        if (cancelled) return;
        markProfileTransitionComplete(baseSrc, src);
        setShowTransformedImage(true);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!cancelled) {
          finish(result.finishReason);
          cleanupOverlay?.();
        }
      })
      .catch(async (error) => {
        if (cancelled) return;
        finish("failed");
        console.warn("[BI] Profile canvas transition failed", error);
        try {
          await transformedImageRef.current?.decode();
          if (!cancelled) {
            setCommittedSrc(src);
            setShowTransformedImage(true);
          }
        } catch {
          // Keep the original visible when the result image cannot be decoded.
        }
      });

    return () => {
      finish("view-disposed-or-source-changed");
      cancelled = true;
      controller.abort();
      if (transitionKeyRef.current === transitionKey) transitionKeyRef.current = null;
      cleanupOverlay?.();
      try {
        container
          .querySelectorAll("canvas")
          .forEach((canvas) => canvas.remove());
      } catch {
        // The transition canvas is best-effort visual state.
      }
    };
    // Playback options can change when another view finishes this asset.
    // Only a different image or unmount may interrupt this canvas.
  }, [baseSrc, src]);

  return (
    <div
      className={className}
      ref={containerRef}
      style={{
        ...style,
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <img
        ref={transformedImageRef}
        onLoad={onLoad}
        loading="lazy"
        decoding="async"
        src={committedSrc || src || baseSrc}
        alt=""
        aria-hidden="true"
        style={{
          height: "100%",
          inset: 0,
          objectFit: "cover",
          ...imageStyle,
          opacity: committedSrc && showTransformedImage ? 1 : 0,
          position: "absolute",
          width: "100%",
          zIndex: 2,
        }}
      />
      <img
        ref={imageRef}
        loading="lazy"
        decoding="async"
        src={baseSrc}
        alt={alt}
        onLoad={onLoad}
        style={{
          height: "100%",
          inset: 0,
          objectFit: "cover",
          ...imageStyle,
          opacity: 1,
          position: "absolute",
          width: "100%",
          zIndex: 1,
        }}
      />
    </div>
  );
}

function ProfileTransformFrame({
  alt,
  aspectRatio,
  assetId,
  baseSrc,
  className,
  faceBox,
  faceLandmarks,
  imageFit = "cover",
  onLoad,
  onVisibleAsset,
  replayTransition = false,
  src,
  transitionVersion,
}) {
  const [measurement, setMeasurement] = useState(null);
  const measuredRatio = measurement && measurement.source === baseSrc ? measurement.ratio : null;
  const frameRatio = measuredRatio || (Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1);
  const fitWidth = className?.includes("fit-width");
  const containFit = imageFit === "contain";
  const frameStyle = {
    aspectRatio: containFit ? undefined : frameRatio,
    height: containFit || !fitWidth ? "100%" : "auto",
    maxWidth: containFit ? "100%" : "none",
    width: containFit || fitWidth ? "100%" : "auto",
  };

  return (
    <ProfileTransformAvatar
      alt={alt}
      assetId={assetId}
      baseSrc={baseSrc}
      className={className}
      faceBox={faceBox}
      faceLandmarks={faceLandmarks}
      imageStyle={{
        height: "100%",
        objectFit: imageFit,
        width: "100%",
      }}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
          const ratio = naturalWidth / naturalHeight;
          setMeasurement((current) => current && current.source === baseSrc && current.ratio === ratio
            ? current : { source: baseSrc, ratio });
        }
        onLoad?.(event);
      }}
      onVisibleAsset={onVisibleAsset}
      replayTransition={replayTransition}
      src={src}
      style={frameStyle}
      transitionVersion={transitionVersion}
    />
  );
}

function Profile({
  profileGender,
  profileData,
  recommendedProfileData,
  recommendedProfilePath,
}) {
  const navigate = useNavigate();
  const [visibleTransformAssetIds, setVisibleTransformAssetIds] = useState([]);
  const transforms = useProfileTransforms(getCurrentAudience()?.gender ?? profileGender, visibleTransformAssetIds);
  const transformElements = useRef(new Map());
  const visibilityFrame = useRef(0);
  const refreshTransformVisibility = useCallback(() => {
    cancelAnimationFrame(visibilityFrame.current);
    visibilityFrame.current = requestAnimationFrame(() => {
      const ranked = [];
      for (const [element, assetId] of transformElements.current) {
        if (!element?.isConnected) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.right <= 0 || rect.left >= window.innerWidth) continue;
        const visible = getElementViewportRatio(element) > 0;
        const nearby = rect.top >= window.innerHeight && rect.top <= window.innerHeight + rect.height;
        if (visible || nearby) ranked.push({ assetId, rank: visible ? 0 : 1, top: rect.top, left: rect.left });
      }
      ranked.sort((a, b) => a.rank - b.rank || a.top - b.top || a.left - b.left);
      const ids = [...new Set(ranked.map((entry) => entry.assetId))];
      setVisibleTransformAssetIds((current) => current.join("|") === ids.join("|") ? current : ids);
    });
  }, []);
  const markVisibleTransformAsset = useCallback((assetId, element) => {
    if (!assetId || !element) return undefined;
    transformElements.current.set(element, assetId);
    refreshTransformVisibility();
    return () => {
      transformElements.current.delete(element);
      refreshTransformVisibility();
    };
  }, [refreshTransformVisibility]);
  useEffect(() => {
    document.addEventListener("scroll", refreshTransformVisibility, true);
    window.addEventListener("resize", refreshTransformVisibility);
    document.addEventListener("load", refreshTransformVisibility, true);
    refreshTransformVisibility();
    return () => {
      document.removeEventListener("scroll", refreshTransformVisibility, true);
      window.removeEventListener("resize", refreshTransformVisibility);
      document.removeEventListener("load", refreshTransformVisibility, true);
      cancelAnimationFrame(visibilityFrame.current);
    };
  }, [refreshTransformVisibility]);
  const prioritizeTransformAsset = useCallback((assetId) => {
    if (!assetId) return;
    setVisibleTransformAssetIds((current) => [
      assetId,
      ...current.filter((currentAssetId) => currentAssetId !== assetId),
    ]);
  }, []);
  const canUseProfileTransforms = transforms.canApply;
  const baseProfileImage = resolveAssetUrl(profileData.user.profileImage);
  const profileAssetId = getProfileAssetId(profileGender);
  const profileAsset = canUseProfileTransforms
    ? transforms.jobs.find(
        (job) => job.assetId === profileAssetId,
      )
    : null;
  const profileUser = {
    ...profileData.user,
    profileImage: transforms.urls[profileAsset?.assetId] ?? baseProfileImage,
  };
  const recommendedUser = recommendedProfileData
    ? {
        ...recommendedProfileData.user,
        profileImage: resolveAssetUrl(recommendedProfileData.user.profileImage),
      }
    : profileUser;
  const currentAudience = getCurrentAudience();
  const profileUsername = profileData.user.username;
  const recommendedProfileUsername = recommendedProfileData?.user?.username;
  const recommendedProfileGender = getProfileGenderByUsername(
    recommendedProfileUsername,
  );
  const canFollowRecommendedProfile =
    recommendedProfileUsername &&
    currentAudience?.gender &&
    currentAudience?.gender !== recommendedProfileGender;
  const [socialState, setSocialState] = useState(() => socialStore.read());
  const profilePosts = [...profileData.posts]
    .sort((firstPost, secondPost) => secondPost.timestamp - firstPost.timestamp)
    .map((post, index) => {
      const transformAssetId = getPostTransformAssetId(post, profileGender, currentAudience?.gender);
      const frameAsset = canUseProfileTransforms
        ? transforms.jobs.find(
            (job) =>
              job.assetId === transformAssetId,
          )
        : null;
      const basePostImage = resolveAssetUrl(post.image);
      const transformedPostImage = transforms.urls[frameAsset?.assetId] ?? null;
      return {
        ...post,
        postIndex: index,
        baseImage: basePostImage,
        transformAssetId,
        faceBox: frameAsset?.faceBox ?? null,
        faceLandmarks: frameAsset?.faceLandmarks ?? null,
        image: transformedPostImage ?? basePostImage,
        imageAspectRatio: frameAsset?.aspectRatio ?? post.aspectRatio ?? null,
        profileImage: profileUser.profileImage,
        baseProfileImage,
        profileFaceBox: profileAsset?.faceBox ?? null,
        profileFaceLandmarks: profileAsset?.faceLandmarks ?? null,
        transformedImage: transformedPostImage,
        username: profileUser.username,
        caption: post.caption ?? "",
        commentTimestamp: getRelativePostTimestamp(post.timestamp),
        displayTimestamp: formatPostTimestamp(post.timestamp),
        taggedUsernames: post.taggedUsernames ?? [],
      };
    });
  const profilePostFrames = Array.from(
    { length: postFrameCount },
    (_, index) => profilePosts[index] ?? null,
  );
  const taggedProfileAsset = canUseProfileTransforms
    ? transforms.jobs.find((job) => job.assetId === getProfileAssetId(recommendedProfileGender))
    : null;
  const taggedPosts = getTaggedPosts(recommendedProfileData, profileUsername)
    .map((post, index) => {
      const transformAssetId = getPostTransformAssetId(post, recommendedProfileGender, currentAudience?.gender);
      const asset = canUseProfileTransforms
        ? transforms.jobs.find((job) => job.assetId === transformAssetId)
        : null;
      const baseImage = resolveAssetUrl(post.image);
      const transformedImage = transforms.urls[asset?.assetId] ?? null;
      return {
        ...post,
        postIndex: profilePosts.length + index,
        baseImage,
        image: transformedImage ?? baseImage,
        transformedImage,
        transformAssetId,
        faceBox: asset?.faceBox ?? null,
        faceLandmarks: asset?.faceLandmarks ?? null,
        imageAspectRatio: asset?.aspectRatio ?? post.aspectRatio ?? null,
        username: recommendedUser.username,
        baseProfileImage: recommendedUser.profileImage,
        profileImage: transforms.urls[taggedProfileAsset?.assetId] ?? recommendedUser.profileImage,
        profileFaceBox: taggedProfileAsset?.faceBox ?? null,
        profileFaceLandmarks: taggedProfileAsset?.faceLandmarks ?? null,
        caption: post.caption ?? "",
        commentTimestamp: getRelativePostTimestamp(post.timestamp),
        displayTimestamp: formatPostTimestamp(post.timestamp),
      };
    });
  const selectablePosts = [...profilePosts, ...taggedPosts];
  const isRecommendedFollowing = socialStore.isFollowingProfile(
    socialState,
    currentAudience,
    recommendedProfileUsername,
  );
  const isRecommendedButtonSelected =
    !canFollowRecommendedProfile || isRecommendedFollowing;
  const initialStats = getInitialStats(profileData);
  const stats = {
    ...initialStats,
    followers:
      initialStats.followers +
      socialStore.getFollowerDelta(socialState, profileUsername),
    following:
      initialStats.following +
      (currentAudience?.gender === profileGender
        ? socialStore.getFollowingDelta(socialState, currentAudience)
        : 0),
  };
  const [selectedPostsTab, setSelectedPostsTab] = useState("posts");
  const [selectedPostIndex, setSelectedPostIndex] = useState(null);
  const [selectedPostHasCompletedTransition, setSelectedPostHasCompletedTransition] = useState(false);
  const [transitionCacheRevision, setTransitionCacheRevision] = useState(0);
  const [poppingLikeIndex, setPoppingLikeIndex] = useState(null);
  const [postOverlayMeasurement, setPostOverlayMeasurement] = useState(null);
  const [postOverlayViewport, setPostOverlayViewport] = useState(() => ({
    width: window.innerWidth, height: window.innerHeight,
  }));
  const selectedPost =
    selectedPostIndex === null ? null : selectablePosts[selectedPostIndex] ?? null;
  const postOverlayImageWidth = `${getPostOverlayWidth(
    getPostOverlayRatio(selectedPost, postOverlayMeasurement),
    postOverlayViewport.width, postOverlayViewport.height,
  )}px`;
  const selectedPostDataIndex =
    selectedPostIndex === null ? null : selectedPostIndex;
  const isSelectedPostLiked =
    selectedPost !== null &&
    socialStore.hasLikedPost(
      socialState,
      currentAudience,
      selectedPost.username,
      selectedPost.id,
    );
  const getPostLikeCount = (post) =>
    post.likes +
    socialStore.getPostLikeDelta(socialState, post.username, post.id);

  const isPostOverlayOpen = selectedPost !== null;
  useEffect(() => {
    if (!isPostOverlayOpen) return;
    return lockPageScroll(document);
  }, [isPostOverlayOpen]);

  useEffect(() => {
    const updatePostOverlayImageWidth = () => {
      setPostOverlayViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    updatePostOverlayImageWidth();
    window.addEventListener("resize", updatePostOverlayImageWidth);

    return () => {
      window.removeEventListener("resize", updatePostOverlayImageWidth);
    };
  }, []);

  const openPostOverlay = (postIndex) => {
    const post = selectablePosts[postIndex];
    setSelectedPostHasCompletedTransition(Boolean(post?.transformedImage &&
      completedProfileTransitionCache.has(getProfileTransitionKey(post.baseImage, post.transformedImage))));
    prioritizeTransformAsset(post?.transformAssetId);
    setSelectedPostIndex(postIndex);
  };

  const toggleSelectedPostLike = (likeOnly = false) => {
    if (selectedPostDataIndex === null || !selectedPost) {
      return;
    }

    const result = updatePostLike(socialStore, currentAudience, selectedPost, likeOnly);
    if (result.added) setPoppingLikeIndex(selectedPostDataIndex);
    setSocialState(result.state);
  };

  const toggleRecommendedFollow = () => {
    if (!canFollowRecommendedProfile) return;

    setSocialState(
      socialStore.toggleFollow(currentAudience, recommendedProfileUsername),
    );
  };

  return (
    <>
      <main>
        <div className="profile">
          <div className="profile--header">
            <div className="profile--header--details">
              <ProfileTransformAvatar
                className="profile--header--details--img"
                alt="프로필 이미지"
                assetId={profileAsset?.assetId ?? profileAssetId}
                baseSrc={baseProfileImage}
                faceBox={profileAsset?.faceBox ?? null}
                faceLandmarks={profileAsset?.faceLandmarks ?? null}
                onVisibleAsset={markVisibleTransformAsset}
                src={profileUser.profileImage}
                style={profileAvatarStyle}
              />
              <div className="profile--header--details--info">
                <div className="profile--header--details--info--username">
                  {profileUser.username}
                </div>
                <div className="profile--header--details--info--name">
                  {profileUser.name}
                </div>
                <div className="profile--header--details--info--datas">
                  <div className="profile--header--details--info--datas--data">
                    <div className="profile--header--details--info--datas--data--dataname">
                      게시물
                    </div>
                    <div className="profile--header--details--info--datas--data--datavalue">
                      {stats.posts}
                    </div>
                  </div>
                  <div className="profile--header--details--info--datas--data">
                    <div className="profile--header--details--info--datas--data--dataname">
                      팔로워
                    </div>
                    <div className="profile--header--details--info--datas--data--datavalue">
                      {stats.followers}
                    </div>
                  </div>
                  <div className="profile--header--details--info--datas--data">
                    <div className="profile--header--details--info--datas--data--dataname">
                      팔로잉
                    </div>
                    <div className="profile--header--details--info--datas--data--datavalue">
                      {stats.following}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="profile--header--highlights">
              <button className="profile--header--highlights--highlight">
                <div className="profile--header--highlights--highlight--thumbnail" />
                <div className="profile--header--highlights--highlight--title">
                  title
                </div>
              </button>
              <button className="profile--header--highlights--highlight">
                <div className="profile--header--highlights--highlight--thumbnail" />
                <div className="profile--header--highlights--highlight--title">
                  title
                </div>
              </button>
            </div>
            <div className="profile--header--recommend">
              <div className="profile--header--recommend--text">
                회원님을 위한 추천
              </div>
              <div className="profile--header--recommend--profiles">
                <div className="profile--header--recommend--profiles--profile">
                  <button
                    className="profile--header--recommend--profiles--profile--info"
                    type="button"
                    onClick={() => {
                      if (recommendedProfilePath) {
                        navigate(recommendedProfilePath);
                      }
                    }}
                  >
                    <div className="profile--header--recommend--profiles--profile--info--img">
                      <img
                        src={recommendedUser.profileImage}
                        style={avatarImageStyle}
                      />
                    </div>
                    <div className="profile--header--recommend--profiles--profile--info--username">
                      {recommendedUser.username}
                    </div>
                    <div className="profile--header--recommend--profiles--profile--info--name">
                      {recommendedUser.name}
                    </div>
                  </button>
                  <button
                    className={`profile--header--recommend--profiles--profile--btn${isRecommendedButtonSelected ? " selected" : ""}`}
                    aria-pressed={isRecommendedButtonSelected}
                    disabled={!canFollowRecommendedProfile}
                    onClick={toggleRecommendedFollow}
                  >
                    {isRecommendedButtonSelected ? "팔로잉" : "팔로우"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="profile--posts">
            <div className="profile--posts--selector">
              <button
                className={`profile--posts--selector--tab${selectedPostsTab === "posts" ? " selected" : ""}`}
                onClick={() => setSelectedPostsTab("posts")}
              >
                <img src={iconPostsO} />
                <img src={iconPostsS} />
              </button>
              <button
                className={`profile--posts--selector--tab${selectedPostsTab === "tagged_posts" ? " selected" : ""}`}
                onClick={() => setSelectedPostsTab("tagged_posts")}
              >
                <img src={iconPostsTaggedO} />
                <img src={iconPostsTaggedS} />
              </button>
            </div>
            {selectedPostsTab === "posts" && (
              <div className="profile--posts--frames" id="posts">
                {profilePostFrames.map((post, index) =>
                  post ? (
                    <PostFrame
                      key={post.id}
                      post={post}
                      postIndex={post.postIndex}
                      likeCount={getPostLikeCount(post)}
                      onOpen={openPostOverlay}
                      onVisibleAsset={markVisibleTransformAsset}
                      renderImage={
                        ({ className, onLoad }) => (
                              <ProfileTransformFrame
                                alt=""
                                aspectRatio={post.imageAspectRatio}
                                assetId={post.transformAssetId}
                                baseSrc={post.baseImage}
                                className={className}
                                faceBox={post.faceBox}
                                faceLandmarks={post.faceLandmarks}
                                onLoad={onLoad}
                                src={post.transformedImage}
                                transitionVersion={transitionCacheRevision}
                              />
                            )
                      }
                    />
                  ) : (
                    <div
                      className="profile--posts--frames--frame"
                      key={`empty-${index}`}
                    />
                  ),
                )}
              </div>
            )}
            {selectedPostsTab === "tagged_posts" && (
              <div className="profile--posts--frames" id="tagged_posts">
                {taggedPosts.map((post) => (
                  <PostFrame
                    key={post.id}
                    post={post}
                    postIndex={post.postIndex}
                    likeCount={getPostLikeCount(post)}
                    onOpen={openPostOverlay}
                    onVisibleAsset={markVisibleTransformAsset}
                    renderImage={
                      ({ className, onLoad }) => (
                            <ProfileTransformFrame
                              alt=""
                              aspectRatio={post.imageAspectRatio}
                              assetId={post.transformAssetId}
                              baseSrc={post.baseImage}
                              className={className}
                              faceBox={post.faceBox}
                              faceLandmarks={post.faceLandmarks}
                              onLoad={onLoad}
                              src={post.transformedImage}
                              transitionVersion={transitionCacheRevision}
                            />
                          )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {selectedPost && (
          <div
            className="post_overlay"
            onClick={() => setSelectedPostIndex(null)}
          >
            <button
              className="post_overlay--close"
              type="button"
              onClick={() => setSelectedPostIndex(null)}
            >
              <img src={iconClose} alt="닫기" />
            </button>
            <div
              className="post_overlay--content"
              style={{ "--post-image-width": postOverlayImageWidth }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="post_overlay--content--img_section">
                <div className="post_overlay--content--img_section--img" onDoubleClick={() => toggleSelectedPostLike(true)}>
                    <ProfileTransformFrame
                      key={selectedPost.id}
                      alt="게시물 이미지"
                      aspectRatio={selectedPost.imageAspectRatio}
                      assetId={selectedPost.transformAssetId}
                      baseSrc={selectedPost.baseImage}
                      className="post_overlay--content--img_section--img--transition"
                      faceBox={selectedPost.faceBox}
                      faceLandmarks={selectedPost.faceLandmarks}
                      imageFit="contain"
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } =
                          event.currentTarget;

                        if (naturalWidth > 0 && naturalHeight > 0) {
                          setPostOverlayMeasurement({
                            source: selectedPost.baseImage,
                            ratio: naturalWidth / naturalHeight,
                          });
                        }
                      }}
                      onVisibleAsset={markVisibleTransformAsset}
                      replayTransition={!selectedPostHasCompletedTransition}
                      src={selectedPost.transformedImage}
                      transitionVersion={selectedPostIndex}
                    />
                </div>
              </div>
              <div className="post_overlay--content--comment_section">
                <div className="post_overlay--content--comment_section--profile">
                  <ProfileTransformAvatar
                    className="post_overlay--content--comment_section--profile--img"
                    baseSrc={selectedPost.baseProfileImage}
                    src={selectedPost.profileImage}
                    faceBox={selectedPost.profileFaceBox}
                    faceLandmarks={selectedPost.profileFaceLandmarks}
                    alt=""
                    imageStyle={avatarImageStyle}
                  />
                  <div className="post_overlay--content--comment_section--profile--username">
                    {selectedPost.username}
                  </div>
                </div>
                <div className="post_overlay--content--comment_section--comment">
                  <div
                    className={`post_overlay--content--comment_section--comment--main${selectedPost.caption ? "" : " hidden"}`}
                  >
                    {selectedPost.caption && (
                      <>
                        <ProfileTransformAvatar
                          className="post_overlay--content--comment_section--comment--main--img"
                          baseSrc={selectedPost.baseProfileImage}
                          src={selectedPost.profileImage}
                          faceBox={selectedPost.profileFaceBox}
                          faceLandmarks={selectedPost.profileFaceLandmarks}
                          alt=""
                          imageStyle={avatarImageStyle}
                        />
                        <div className="post_overlay--content--comment_section--comment--main--text">
                          <div className="post_overlay--content--comment_section--comment--main--text--upper">
                            <span className="post_overlay--content--comment_section--comment--main--text--upper--username">
                              {selectedPost.username}
                            </span>
                            <span className="post_overlay--content--comment_section--comment--main--text--upper--caption">
                              {selectedPost.caption}
                            </span>
                          </div>
                          <div className="post_overlay--content--comment_section--comment--main--text--timestamp">
                            {selectedPost.commentTimestamp}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="post_overlay--content--comment_section--like">
                  <button
                    className={`post_overlay--content--comment_section--like--btn${isSelectedPostLiked ? " selected" : ""}${poppingLikeIndex === selectedPostDataIndex ? " pop" : ""}`}
                    type="button"
                    aria-pressed={isSelectedPostLiked}
                    onClick={() => toggleSelectedPostLike()}
                    onAnimationEnd={() => setPoppingLikeIndex(null)}
                  >
                    <img src={iconHeartO} alt="" />
                    <img src={iconHeartS} alt="" />
                  </button>
                </div>
                <div className="post_overlay--content--comment_section--like_data">
                  좋아요 {getPostLikeCount(selectedPost)}개
                </div>
                <div className="post_overlay--content--comment_section--timestamp">
                  {selectedPost.displayTimestamp}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default Profile;

<script lang="ts" setup>
import { CloseOutlined } from '@vicons/material';
import { useEventListener } from '@vueuse/core';

type CacheMetrics = {
  entryCount: number;
  totalSize: number;
  hit: number;
  miss: number;
  deduplicated: number;
  provider: number;
  fault: number;
};

type PipelineMetrics = {
  outstanding: number;
  queued: number;
  waitingProducers: number;
};

type WorkerMetrics = {
  total: number;
  running: number;
  starting: number;
  stopped: number;
  active: number;
  maximum: number;
  errors: number;
};

defineProps<{
  cacheMetrics?: CacheMetrics;
  pipelineMetrics?: PipelineMetrics;
  workerMetrics?: WorkerMetrics;
}>();

const panel = useTemplateRef('panel');
const open = ref(false);
const positioned = ref(false);
const hasRememberedPosition = ref(false);
const position = reactive({ x: 0, y: 0 });
const viewportHeight = ref(window.visualViewport?.height ?? window.innerHeight);

const syncViewportHeight = () => {
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight;
};

const panelMaxHeight = computed(() =>
  Math.max(120, Math.floor(viewportHeight.value - 66)),
);

const panelStyle = computed(() => ({
  left: `${position.x}px`,
  top: `${position.y}px`,
  maxHeight: `${panelMaxHeight.value}px`,
  '--workspace-metrics-panel-max-height': `${panelMaxHeight.value}px`,
}));

const clampPosition = (x: number, y: number) => {
  const bounds = panel.value?.getBoundingClientRect();
  if (bounds === undefined) return;
  const edge = 8;
  position.x = Math.round(
    Math.min(
      Math.max(edge, x),
      Math.max(edge, window.innerWidth - bounds.width - edge),
    ),
  );
  position.y = Math.round(
    Math.min(
      Math.max(edge, y),
      Math.max(edge, viewportHeight.value - bounds.height - edge),
    ),
  );
};

const placePanel = async () => {
  syncViewportHeight();
  await nextTick();
  const bounds = panel.value?.getBoundingClientRect();
  if (bounds === undefined) return;
  if (hasRememberedPosition.value) {
    clampPosition(position.x, position.y);
  } else {
    const mobile = window.innerWidth < 640;
    const right = mobile ? 12 : 24;
    position.x = window.innerWidth - bounds.width - right;
    position.y = mobile ? 58 : 64;
    hasRememberedPosition.value = true;
  }
  positioned.value = true;
};

const toggle = () => {
  open.value = !open.value;
  if (open.value) void placePanel();
};

const close = () => {
  cancelLongPress();
  open.value = false;
};

let removeMoveListener: (() => void) | undefined;
let removeUpListener: (() => void) | undefined;
let longPressTimer: number | undefined;
let longPressOrigin: { x: number; y: number } | undefined;

const cancelLongPress = () => {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  longPressTimer = undefined;
  longPressOrigin = undefined;
};

const startLongPress = (event: PointerEvent) => {
  if (window.innerWidth >= 640 || event.button !== 0) return;
  cancelLongPress();
  longPressOrigin = { x: event.clientX, y: event.clientY };
  longPressTimer = window.setTimeout(close, 1000);
};

const trackLongPress = (event: PointerEvent) => {
  if (
    longPressOrigin !== undefined &&
    Math.hypot(
      event.clientX - longPressOrigin.x,
      event.clientY - longPressOrigin.y,
    ) > 8
  ) {
    cancelLongPress();
  }
};

const finishDrag = () => {
  removeMoveListener?.();
  removeUpListener?.();
  removeMoveListener = undefined;
  removeUpListener = undefined;
};

const startDrag = (event: PointerEvent) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const offsetX = event.clientX - position.x;
  const offsetY = event.clientY - position.y;
  finishDrag();
  const onMove = (moveEvent: PointerEvent) => {
    clampPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
  };
  removeMoveListener = useEventListener(window, 'pointermove', onMove);
  removeUpListener = useEventListener(window, 'pointerup', finishDrag, {
    once: true,
  });
};

const handleViewportResize = () => {
  syncViewportHeight();
  if (open.value) void placePanel();
};

useEventListener(window, 'resize', handleViewportResize);
if (window.visualViewport) {
  useEventListener(window.visualViewport, 'resize', handleViewportResize);
}
onBeforeUnmount(() => {
  finishDrag();
  cancelLongPress();
});
</script>

<template>
  <c-button
    label="运行统计"
    class="workspace-metrics-trigger"
    aria-label="翻译器运行统计"
    :type="open ? 'primary' : 'default'"
    @action="toggle"
  />

  <section
    v-if="open"
    ref="panel"
    class="workspace-metrics-panel"
    :class="{ 'workspace-metrics-panel--positioned': positioned }"
    :style="panelStyle"
    role="dialog"
    aria-label="翻译器运行统计"
  >
    <n-card
      class="workspace-metrics-panel__surface"
      size="small"
      content-style="padding: 0"
    >
      <header class="workspace-metrics-panel__header" @pointerdown="startDrag">
        <n-text strong>运行统计</n-text>
        <n-button
          quaternary
          circle
          size="small"
          aria-label="关闭运行统计"
          @pointerdown.stop
          @click="close"
        >
          <n-icon :component="CloseOutlined" />
        </n-button>
      </header>

      <div
        class="workspace-metrics-panel__body"
        @pointerdown.passive="startLongPress"
        @pointermove.passive="trackLongPress"
        @pointerup.passive="cancelLongPress"
        @pointercancel.passive="cancelLongPress"
        @pointerleave.passive="cancelLongPress"
      >
        <section aria-label="翻译缓存统计">
          <n-text depth="3" class="workspace-metrics-panel__section-title">
            翻译缓存
          </n-text>
          <div v-if="cacheMetrics" class="workspace-metrics-panel__grid">
            <div class="workspace-metrics-panel__metric">
              <span>缓存</span>
              <strong>{{ cacheMetrics.entryCount }} 条</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>占用</span>
              <strong>
                {{ (cacheMetrics.totalSize / 1024 / 1024).toFixed(2) }} MiB
              </strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>命中</span>
              <strong>{{ cacheMetrics.hit }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>未命中</span>
              <strong>{{ cacheMetrics.miss }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>并发复用</span>
              <strong>{{ cacheMetrics.deduplicated }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>请求</span>
              <strong>{{ cacheMetrics.provider }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>故障</span>
              <strong>{{ cacheMetrics.fault }}</strong>
            </div>
          </div>
          <n-skeleton v-else text :repeat="2" />
        </section>

        <section v-if="workerMetrics" aria-label="翻译器总览">
          <n-divider />
          <n-text depth="3" class="workspace-metrics-panel__section-title">
            翻译器总览
          </n-text>
          <div class="workspace-metrics-panel__grid">
            <div class="workspace-metrics-panel__metric">
              <span>已配置</span>
              <strong>{{ workerMetrics.total }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>运行中</span>
              <strong>{{ workerMetrics.running }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>连接中</span>
              <strong>{{ workerMetrics.starting }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>已停止</span>
              <strong>{{ workerMetrics.stopped }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>活跃请求</span>
              <strong>
                {{ workerMetrics.active }}/{{ workerMetrics.maximum }}
              </strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>错误</span>
              <strong>{{ workerMetrics.errors }}</strong>
            </div>
          </div>
        </section>

        <section v-if="pipelineMetrics" aria-label="共享池统计">
          <n-divider />
          <n-text depth="3" class="workspace-metrics-panel__section-title">
            共享池
          </n-text>
          <div class="workspace-metrics-panel__grid">
            <div class="workspace-metrics-panel__metric">
              <span>未完成</span>
              <strong>{{ pipelineMetrics.outstanding }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>排队</span>
              <strong>{{ pipelineMetrics.queued }}</strong>
            </div>
            <div class="workspace-metrics-panel__metric">
              <span>背压等待</span>
              <strong>{{ pipelineMetrics.waitingProducers }}</strong>
            </div>
          </div>
        </section>
      </div>
    </n-card>
  </section>
</template>

<style scoped>
.workspace-metrics-trigger {
  flex: none;
}

.workspace-metrics-panel {
  position: fixed;
  z-index: 1000;
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100dvh - 66px);
  overflow: hidden;
  visibility: hidden;
}

.workspace-metrics-panel--positioned {
  visibility: visible;
}

.workspace-metrics-panel__surface {
  overflow: hidden;
  border-radius: 12px;
  box-shadow: 0 12px 36px rgb(0 0 0 / 24%);
}

.workspace-metrics-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 4px 8px 4px 16px;
  border-bottom: 1px solid var(--n-border-color);
  cursor: move;
  user-select: none;
  touch-action: none;
}

.workspace-metrics-panel__body {
  max-height: calc(var(--workspace-metrics-panel-max-height) - 44px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 16px;
  touch-action: pan-y;
}

.workspace-metrics-panel__section-title {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
}

.workspace-metrics-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.workspace-metrics-panel__metric {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--n-action-color);
}

.workspace-metrics-panel__metric span {
  overflow: hidden;
  color: var(--n-text-color-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-metrics-panel__metric strong {
  overflow: hidden;
  color: var(--n-text-color);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-metrics-panel :deep(.n-divider) {
  margin: 14px 0;
}

@media (max-width: 639px) {
  .workspace-metrics-panel {
    width: calc(100vw - 24px);
    max-height: calc(100dvh - 66px);
    border-radius: 10px;
  }

  .workspace-metrics-panel__body {
    padding: 12px;
  }

  .workspace-metrics-panel__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-metrics-panel__metric {
    padding: 8px 10px;
  }
}
</style>

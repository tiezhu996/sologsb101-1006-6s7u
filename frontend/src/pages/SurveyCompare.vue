<script setup lang="ts">
/**
 * /surveys 复测测次与变化量对比
 * 按测次追加读数，自动与前一次有效测次比对生成变化量，并用折线对比历次宽度。
 * 误录测次可作废（必填原因、保留原值）或恢复，台账与速率按最新有效测次计算。
 * 消费 Survey、Crack；复用 <FilterBar>、<EmptyPanel>、<LevelTag>。
 */
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { CircleClose, Delete, Edit, Plus, RefreshLeft } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar from '@/components/common/FilterBar.vue'
import LevelTag from '@/components/common/LevelTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useCrackStore, type CrackEnriched } from '@/stores/crackStore'
import { useSurveyStore } from '@/stores/surveyStore'
import { useSectionStore } from '@/stores/sectionStore'
import { useCrackTrend } from '@/hooks/useCrackTrend'
import {
  EMPTY_SURVEY_DRAFT,
  isSurveyEffective,
  type Survey,
  type SurveyDraft
} from '@/types/survey'
import type { CrackDirection, CrackPosition } from '@/types/crack'
import { round } from '@/utils/rate'

type FilterModel = { keyword: string; [key: string]: string | string[] | boolean }

const crackStore = useCrackStore()
const surveyStore = useSurveyStore()
const sectionStore = useSectionStore()

const activeCrackId = computed(() => surveyStore.activeCrackId)
const activeCrack = computed<CrackEnriched | null>(
  () => crackStore.enriched.find((item) => item.crack.id === activeCrackId.value) ?? null
)
const trend = useCrackTrend(activeCrackId)

/* ------------------------------ 筛选 ------------------------------ */

const filterModel = computed<FilterModel>(() => ({
  keyword: crackStore.filter.keyword,
  line: crackStore.filter.lines,
  position: crackStore.filter.positions,
  direction: crackStore.filter.directions
}))

const filterSelects = computed(() => [
  { key: 'line', label: '线路', options: sectionStore.lineOptions },
  { key: 'position', label: '部位', options: crackStore.positionOptions.map((item) => ({ label: item, value: item })) },
  { key: 'direction', label: '走向', options: crackStore.directionOptions.map((item) => ({ label: item, value: item })) }
])

function onFilterChange(model: FilterModel): void {
  crackStore.patchFilter({
    keyword: String(model.keyword ?? ''),
    lines: Array.isArray(model.line) ? model.line : [],
    positions: (Array.isArray(model.position) ? model.position : []) as CrackPosition[],
    directions: (Array.isArray(model.direction) ? model.direction : []) as CrackDirection[]
  })
}

const candidateCracks = computed(() => crackStore.filtered)

/* ------------------------------ 折线图 ------------------------------ */

const chart = computed(() => {
  const points = trend.points.value
  if (points.length === 0) return null
  const width = 760
  const height = 250
  const padLeft = 62
  const padRight = 28
  const padTop = 24
  const padBottom = 46
  const values = points.map((point) => point.widthMm)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min < 0.001 ? 1 : max - min
  const stepX = points.length > 1 ? (width - padLeft - padRight) / (points.length - 1) : 0
  const coords = points.map((point, index) => ({
    ...point,
    x: padLeft + stepX * index,
    y: padTop + (height - padTop - padBottom) * (1 - (point.widthMm - min) / span)
  }))
  // 折线只连接有效测次；作废测次保留取点但以灰色空心标记展示
  const effectiveCoords = coords.filter((item) => !item.voided)
  return {
    width,
    height,
    padLeft,
    padTop,
    padBottom,
    min,
    max,
    coords,
    polyline: effectiveCoords.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(' '),
    baseline: height - padBottom,
    top: padTop
  }
})

/* ---------------------------- 测次表单 ---------------------------- */

const dialogVisible = ref(false)
const dialogTitle = ref('追加测次')
const formRef = ref<FormInstance>()
const form = reactive<SurveyDraft>({ ...EMPTY_SURVEY_DRAFT })
const rules: FormRules = {
  date: [{ required: true, message: '请选择复测日期', trigger: 'change' }],
  widthMm: [{ required: true, message: '请填写复测宽度', trigger: 'blur' }],
  surveyor: [{ required: true, message: '请填写复测人', trigger: 'blur' }]
}
let editingId: string | null = null

function openCreate(): void {
  if (!activeCrackId.value) {
    ElMessage.warning('请先在左侧选择一条裂缝')
    return
  }
  editingId = null
  dialogTitle.value = `追加测次 · ${activeCrack.value?.crack.code ?? ''}`
  const previous = trend.latest.value
  Object.assign(form, {
    crackId: activeCrackId.value,
    date: new Date().toISOString().slice(0, 10),
    widthMm: previous ? round(previous.widthMm, 2) : activeCrack.value?.crack.widthMm ?? 0,
    lengthMm: previous ? previous.lengthMm : activeCrack.value?.crack.lengthMm ?? 0,
    surveyor: previous ? '' : '周维'
  })
  dialogVisible.value = true
}

function openEdit(surveyId: string): void {
  const survey = trend.surveys.value.find((item) => item.id === surveyId)
  if (!survey) return
  editingId = surveyId
  dialogTitle.value = `编辑测次 · 第 ${survey.seq} 测次`
  Object.assign(form, {
    crackId: survey.crackId,
    date: survey.date,
    widthMm: survey.widthMm,
    lengthMm: survey.lengthMm,
    surveyor: survey.surveyor
  })
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  const instance = formRef.value
  if (!instance) return
  const valid = await instance.validate().catch(() => false)
  if (!valid) return
  if (editingId) {
    await surveyStore.updateSurvey(editingId, { ...form })
    ElMessage.success('测次已更新，变化量与速率已重新计算')
  } else {
    await surveyStore.createSurvey({ ...form })
    ElMessage.success('测次已追加，变化量已自动比对')
  }
  dialogVisible.value = false
}

async function removeSurvey(surveyId: string, seq: number): Promise<void> {
  const confirmed = await ElMessageBox.confirm(`确认删除第 ${seq} 测次？后续测次序号会自动前移。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消'
  }).catch(() => false)
  if (!confirmed) return
  await surveyStore.removeSurvey(surveyId)
  ElMessage.success('测次已删除')
}

/* ---------------------------- 作废与恢复 ---------------------------- */

/** 首条有效测次（初测）id：初测不能作废 */
const firstEffectiveId = computed(
  () => trend.surveys.value.find((survey) => isSurveyEffective(survey))?.id ?? null
)

function isFirstEffective(survey: Survey): boolean {
  return survey.id === firstEffectiveId.value
}

async function voidSurvey(survey: Survey): Promise<void> {
  if (isFirstEffective(survey)) {
    ElMessage.warning('初测（首条有效测次）不能作废')
    return
  }
  const result = await ElMessageBox.prompt(
    `作废第 ${survey.seq} 测次（${survey.date}，${survey.widthMm.toFixed(2)} mm）后，原值保留但不再参与台账宽度、变化量与速率计算。请填写作废原因。`,
    '作废测次',
    {
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
      inputPlaceholder: '如：读数误录，与现场复核值不符',
      inputValidator: (value: string) => (value.trim().length > 0 ? true : '必须填写作废原因'),
      inputErrorMessage: '必须填写作废原因'
    }
  ).catch(() => null)
  if (!result) return
  const ok = await surveyStore.voidSurvey(survey.id, result.value)
  if (ok) {
    ElMessage.success('测次已作废，台账与速率已按最新有效测次重算')
  } else {
    ElMessage.warning('初测（首条有效测次）不能作废')
  }
}

async function restoreSurvey(survey: Survey): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `恢复第 ${survey.seq} 测次（${survey.date}，${survey.widthMm.toFixed(2)} mm）？恢复后将按日期重新纳入变化量与速率计算。`,
    '恢复测次',
    { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await surveyStore.restoreSurvey(survey.id)
  ElMessage.success('测次已恢复，变化量与速率已重新计算')
}

function surveyRowClass({ row }: { row: Survey }): string {
  return isSurveyEffective(row) ? '' : 'row-voided'
}

function selectCrack(crackId: string): void {
  surveyStore.setActiveCrack(crackId)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-head__title">复测测次与变化量对比</h2>
        <p class="page-head__desc">
          选定裂缝后按测次追加读数，系统自动与上一有效测次比对生成变化量并换算月均速率；误录测次可作废（保留原值）或恢复，台账按最新有效测次取值。
        </p>
      </div>
      <div class="page-head__actions">
        <el-button type="primary" :icon="Plus" :disabled="!activeCrackId" @click="openCreate">追加测次</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="测次总数" :value="surveyStore.surveys.length" suffix="次" icon="DataLine" tone="primary" />
      <StatBadge label="已复测裂缝" :value="surveyStore.rates.length" suffix="条" icon="Files" tone="info" />
      <StatBadge label="预警裂缝" :value="surveyStore.warningCrackIds.length" suffix="条" icon="WarningFilled" tone="danger" />
      <StatBadge label="作废测次" :value="surveyStore.voidedTotal" suffix="次" icon="CircleCloseFilled" tone="warning" />
      <StatBadge
        label="最高月均速率"
        :value="surveyStore.rates.length > 0 ? surveyStore.rates[0].rate.toFixed(3) : '0.000'"
        suffix="mm/月"
        icon="TrendCharts"
        tone="warning"
      />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="搜索裂缝编号 / 环号"
      @change="onFilterChange"
    />

    <div class="grid-two" style="margin-top: 16px">
      <div class="panel">
        <h3 class="panel-title">裂缝列表（{{ candidateCracks.length }}）</h3>
        <EmptyPanel
          v-if="candidateCracks.length === 0"
          title="没有可复测的裂缝"
          description="先到裂缝初测录入页建立裂缝档案。"
          compact
        />
        <div
          v-for="item in candidateCracks"
          :key="item.crack.id"
          class="section-card"
          :class="{ 'is-active': item.crack.id === activeCrackId }"
          @click="selectCrack(item.crack.id)"
        >
          <div class="section-card__head">
            <span class="section-card__title">{{ item.crack.code }}</span>
            <LevelTag :level="item.level" size="small" />
          </div>
          <div class="section-card__meta">
            <span>{{ item.sectionLabel }}</span>
            <span>· {{ item.ringLabel }}</span>
          </div>
          <div class="section-card__meta">
            <span>{{ item.crack.position }} / {{ item.crack.direction }}</span>
            <span>· 测次 {{ item.surveyCount }}</span>
            <span v-if="item.voidedCount > 0" style="color: #c0392b">· 作废 {{ item.voidedCount }}</span>
            <span>· {{ item.rate.toFixed(3) }} mm/月</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <template v-if="activeCrack">
          <div class="panel-head">
            <h3 class="panel-title">
              {{ activeCrack.crack.code }} · 宽度发展曲线
              <span class="muted">{{ activeCrack.sectionLabel }} / {{ activeCrack.ringLabel }}</span>
            </h3>
            <div style="display: flex; align-items: center; gap: 8px">
              <span class="muted">
                累计变化 {{ trend.delta.value.toFixed(2) }} mm · 月均 {{ trend.rate.value.toFixed(3) }} mm/月
              </span>
              <LevelTag :level="trend.level.value" :rate="trend.rate.value" />
            </div>
          </div>

          <div v-if="!chart" class="empty-panel is-compact">
            <p class="empty-panel__desc">该裂缝还没有复测记录，点击「追加测次」录入第一条读数。</p>
          </div>

          <div v-else class="chart-wrap">
            <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" width="100%" height="250" role="img">
              <line
                :x1="chart.padLeft - 12"
                :y1="chart.top"
                :x2="chart.padLeft - 12"
                :y2="chart.baseline"
                stroke="#dbe3ee"
                stroke-width="1"
              />
              <line
                :x1="chart.padLeft - 12"
                :y1="chart.baseline"
                :x2="chart.width - 12"
                :y2="chart.baseline"
                stroke="#dbe3ee"
                stroke-width="1"
              />
              <text :x="8" :y="chart.top + 4" fill="#5b6b82" font-size="12">{{ chart.max.toFixed(2) }}</text>
              <text :x="8" :y="chart.baseline" fill="#5b6b82" font-size="12">{{ chart.min.toFixed(2) }}</text>
              <polyline :points="chart.polyline" fill="none" stroke="#2b5c94" stroke-width="2.5" stroke-linejoin="round" />
              <g v-for="point in chart.coords" :key="point.seq">
                <template v-if="point.voided">
                  <circle :cx="point.x" :cy="point.y" r="4.5" fill="#f2f5f9" stroke="#9aa6b5" stroke-width="2" stroke-dasharray="3 2" />
                  <text :x="point.x" :y="point.y - 12" fill="#9aa6b5" font-size="12" text-anchor="middle" text-decoration="line-through">
                    {{ point.widthMm.toFixed(2) }}
                  </text>
                  <text :x="point.x" :y="point.y + 16" fill="#c0392b" font-size="10" text-anchor="middle">废</text>
                </template>
                <template v-else>
                  <circle :cx="point.x" :cy="point.y" r="4.5" fill="#fff" stroke="#13335c" stroke-width="2.5" />
                  <text :x="point.x" :y="point.y - 12" fill="#16233a" font-size="12" text-anchor="middle">
                    {{ point.widthMm.toFixed(2) }}
                  </text>
                </template>
                <text :x="point.x" :y="chart.baseline + 22" fill="#5b6b82" font-size="11" text-anchor="middle">
                  第{{ point.seq }}次
                </text>
                <text :x="point.x" :y="chart.baseline + 36" fill="#8c99ab" font-size="10" text-anchor="middle">
                  {{ point.date.slice(5) }}
                </text>
              </g>
            </svg>
          </div>

          <h4 class="panel-subtitle">
            测次明细
            <span v-if="trend.voidedCount.value > 0" class="muted">
              （含 {{ trend.voidedCount.value }} 条已作废，不参与计算）
            </span>
          </h4>
          <el-table :data="trend.surveys.value" border stripe size="small" :row-class-name="surveyRowClass">
            <el-table-column label="测次" width="86">
              <template #default="{ row }">
                {{ row.seq }}
                <el-tag v-if="!isSurveyEffective(row)" size="small" type="danger" effect="plain">作废</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="date" label="复测日期" width="110" />
            <el-table-column label="宽度(mm)" width="90">
              <template #default="{ row }">{{ row.widthMm.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="长度(mm)" width="90">
              <template #default="{ row }">{{ row.lengthMm }}</template>
            </el-table-column>
            <el-table-column label="变化量(mm)" width="100">
              <template #default="{ row }">
                <span :style="{ color: row.deltaWidthMm > 0 ? '#c0392b' : '#5b6b82' }">
                  {{ row.deltaWidthMm > 0 ? '+' : '' }}{{ row.deltaWidthMm.toFixed(2) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="surveyor" label="复测人" width="90" />
            <el-table-column label="作废原因" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="!isSurveyEffective(row)">{{ row.voidReason || '—' }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="168">
              <template #default="{ row }">
                <el-tooltip content="作废测次保留原值不可编辑，请先恢复" placement="top" :disabled="isSurveyEffective(row)">
                  <span>
                    <el-button size="small" text type="primary" :disabled="!isSurveyEffective(row)" @click="openEdit(row.id)">
                      <el-icon><Edit /></el-icon>
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip
                  v-if="isSurveyEffective(row)"
                  :content="isFirstEffective(row) ? '初测（首条有效测次）不能作废' : '作废：保留原值，移出计算'"
                  placement="top"
                >
                  <span>
                    <el-button size="small" text type="warning" :disabled="isFirstEffective(row)" @click="voidSurvey(row)">
                      <el-icon><CircleClose /></el-icon>
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip v-else content="恢复：按日期重新纳入计算" placement="top">
                  <el-button size="small" text type="success" @click="restoreSurvey(row)">
                    <el-icon><RefreshLeft /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="删除测次（不保留记录）" placement="top">
                  <el-button size="small" text type="danger" @click="removeSurvey(row.id, row.seq)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <EmptyPanel
          v-else
          title="尚未选择裂缝"
          description="在左侧裂缝列表中选择一条裂缝，即可查看历次测次宽度对比曲线。"
          compact
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="复测日期" prop="date">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="复测宽度(mm)" prop="widthMm">
          <el-input-number v-model="form.widthMm" :min="0" :step="0.01" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="复测长度(mm)" prop="lengthMm">
          <el-input-number v-model="form.lengthMm" :min="0" :step="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="复测人" prop="surveyor">
          <el-input v-model="form.surveyor" placeholder="如 周维" />
        </el-form-item>
        <el-alert
          v-if="trend.latest.value"
          type="info"
          :closable="false"
          :title="`上一有效测次宽度 ${trend.latest.value.widthMm.toFixed(2)} mm（${trend.latest.value.date}），保存后自动换算变化量与月均速率。`"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.panel-subtitle {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

svg text {
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

:deep(.row-voided) {
  background: #f5f6f8 !important;
  color: #8c99ab;
}
</style>

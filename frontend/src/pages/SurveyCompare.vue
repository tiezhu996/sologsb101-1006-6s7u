<script setup lang="ts">
/**
 * /surveys 复测测次与变化量对比
 * 按测次追加读数，自动与前一次比对生成变化量，并用折线对比历次宽度。
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
  return {
    width,
    height,
    padLeft,
    padTop,
    padBottom,
    min,
    max,
    coords,
    polyline: coords.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(' '),
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
  if (!survey || survey.voided === true) return
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

/* ---------------------------- 作废 / 恢复 ---------------------------- */

const voidDialogVisible = ref(false)
const voidFormRef = ref<FormInstance>()
const voidForm = reactive<{ surveyId: string; reason: string }>({ surveyId: '', reason: '' })
const voidRules: FormRules = {
  reason: [{ required: true, message: '作废必须填写原因', trigger: 'blur' }]
}
const voidingSurvey = computed(() =>
  voidForm.surveyId ? trend.surveys.value.find((item) => item.id === voidForm.surveyId) ?? null : null
)

function isInitial(surveyId: string): boolean {
  return trend.initialSurveyId.value === surveyId
}

function openVoid(surveyId: string): void {
  if (isInitial(surveyId)) {
    ElMessage.warning('初测读数是复测链基准，不能作废；如确有错误请编辑初测读数。')
    return
  }
  voidForm.surveyId = surveyId
  voidForm.reason = ''
  voidDialogVisible.value = true
}

async function submitVoid(): Promise<void> {
  const instance = voidFormRef.value
  if (!instance) return
  const valid = await instance.validate().catch(() => false)
  if (!valid) return
  await surveyStore.voidSurvey(voidForm.surveyId, voidForm.reason)
  ElMessage.success('读数已作废，原读数已保留；台账宽度、变化量与预警改按最新有效测次计算')
  voidDialogVisible.value = false
}

async function restoreSurvey(surveyId: string, seq: number): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确认恢复第 ${seq} 测次？恢复后该读数按日期重新纳入变化量与速率计算。`,
    '恢复确认',
    { type: 'info', confirmButtonText: '确认恢复', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await surveyStore.restoreSurvey(surveyId)
  ElMessage.success('读数已恢复并按日期重新纳入计算')
}

function selectCrack(crackId: string): void {
  surveyStore.setActiveCrack(crackId)
}

function surveyRowClass({ row }: { row: { voided?: boolean } }): string {
  return row.voided ? 'row-voided' : ''
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-head__title">复测测次与变化量对比</h2>
        <p class="page-head__desc">
          选定裂缝后按测次追加读数，系统自动与上一测次比对生成变化量并换算月均速率。
        </p>
      </div>
      <div class="page-head__actions">
        <el-button type="primary" :icon="Plus" :disabled="!activeCrackId" @click="openCreate">追加测次</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="有效测次" :value="surveyStore.surveys.length - surveyStore.totalVoidedCount" suffix="次" icon="DataLine" tone="primary" />
      <StatBadge label="作废读数" :value="surveyStore.totalVoidedCount" suffix="次" icon="CircleClose" tone="default" />
      <StatBadge label="已复测裂缝" :value="surveyStore.measuredCrackCount" suffix="条" icon="Files" tone="info" />
      <StatBadge label="预警裂缝" :value="surveyStore.warningCrackIds.length" suffix="条" icon="WarningFilled" tone="danger" />
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
            <span>· 有效测次 {{ item.surveyCount }}</span>
            <span v-if="item.voidedCount > 0" style="color: #95a0b0">· 作废 {{ item.voidedCount }}</span>
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
            <p class="empty-panel__desc">该裂缝还没有有效复测记录，点击「追加测次」录入第一条读数。</p>
          </div>

          <el-alert
            v-if="trend.voidedCount.value > 0"
            type="warning"
            :closable="false"
            show-icon
            style="margin: 8px 0"
            :title="`有 ${trend.voidedCount.value} 条作废读数：原值保留但不参与计算，台账宽度、变化量与预警均按最新有效测次取值；恢复后按日期重新纳入。`"
          />

          <div v-if="chart" class="chart-wrap">
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
                <circle :cx="point.x" :cy="point.y" r="4.5" fill="#fff" stroke="#13335c" stroke-width="2.5" />
                <text :x="point.x" :y="point.y - 12" fill="#16233a" font-size="12" text-anchor="middle">
                  {{ point.widthMm.toFixed(2) }}
                </text>
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
            <span class="muted" style="font-weight: 400">
              （有效 {{ trend.validSurveys.value.length }} 次<span v-if="trend.voidedCount.value > 0"> · 作废 {{ trend.voidedCount.value }} 次</span>）
            </span>
          </h4>
          <el-table :data="trend.allPoints.value" border stripe size="small" :row-class-name="surveyRowClass">
            <el-table-column prop="seq" label="测次" width="64" />
            <el-table-column prop="date" label="复测日期" width="112" />
            <el-table-column label="宽度(mm)" width="98">
              <template #default="{ row }">
                <span :class="{ 'is-voided': row.voided }">{{ row.widthMm.toFixed(2) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="长度(mm)" width="88">
              <template #default="{ row }">
                <span :class="{ 'is-voided': row.voided }">{{ row.lengthMm }}</span>
              </template>
            </el-table-column>
            <el-table-column label="变化量(mm)" width="108">
              <template #default="{ row }">
                <span v-if="row.voided" class="is-voided">—</span>
                <span v-else :style="{ color: row.deltaWidthMm > 0 ? '#c0392b' : '#5b6b82' }">
                  {{ row.deltaWidthMm > 0 ? '+' : '' }}{{ row.deltaWidthMm.toFixed(2) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="月均速率" width="104">
              <template #default="{ row }">
                <span v-if="row.voided" class="is-voided">—</span>
                <span v-else>{{ row.rate.toFixed(3) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="surveyor" label="复测人" width="88">
              <template #default="{ row }">{{ row.surveyor }}</template>
            </el-table-column>
            <el-table-column label="状态" width="92">
              <template #default="{ row }">
                <el-tag v-if="row.voided" size="small" type="info" effect="plain">已作废</el-tag>
                <el-tag v-else size="small" type="success" effect="plain">有效</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="作废原因" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.voided" class="void-reason">{{ row.voidReason || '—' }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <template v-if="row.voided">
                  <el-tooltip content="恢复后按日期重新纳入有效链计算" placement="top">
                    <el-button size="small" text type="success" @click="restoreSurvey(row.id, row.seq)">
                      <el-icon><RefreshLeft /></el-icon> 恢复
                    </el-button>
                  </el-tooltip>
                </template>
                <template v-else>
                  <el-button size="small" text type="primary" @click="openEdit(row.id)">
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <el-tooltip
                    :disabled="!isInitial(row.id)"
                    content="初测读数是复测链基准，不能作废"
                    placement="top"
                  >
                    <span>
                      <el-button
                        size="small"
                        text
                        type="warning"
                        :disabled="isInitial(row.id)"
                        @click="openVoid(row.id)"
                      >
                        <el-icon><CircleClose /></el-icon> 作废
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-button size="small" text type="danger" @click="removeSurvey(row.id, row.seq)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
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

    <el-dialog v-model="voidDialogVisible" title="作废复测读数" width="480px">
      <el-form ref="voidFormRef" :model="voidForm" :rules="voidRules" label-width="96px">
        <el-form-item label="测次">
          <el-input
            :model-value="voidingSurvey ? `第 ${voidingSurvey.seq} 测次 · ${voidingSurvey.date} · ${voidingSurvey.widthMm.toFixed(2)} mm` : ''"
            disabled
          />
        </el-form-item>
        <el-form-item label="作废原因" prop="reason">
          <el-input
            v-model="voidForm.reason"
            type="textarea"
            :rows="3"
            placeholder="如：复测后核对发现读数录错（必填）"
          />
        </el-form-item>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="作废后原读数完整保留，但不再参与台账宽度、变化量、速率与预警；可随时恢复，恢复后按日期重新纳入计算。初测读数不能作废。"
        />
      </el-form>
      <template #footer>
        <el-button @click="voidDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="submitVoid">确认作废</el-button>
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

.is-voided {
  color: #95a0b0;
  text-decoration: line-through;
}

.void-reason {
  color: #8a6d3b;
}

:deep(.row-voided) {
  background: #f5f6f8 !important;
  color: #95a0b0;
}
</style>

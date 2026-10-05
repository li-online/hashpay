<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import * as pay from "@/app/payments";
import { api } from "@/app/api";
import { useI18n } from "@/app/i18n";
import {
  ceilDisplayAmount,
  formatExactDisplayAmount as formatExactAmount,
  formatIntegerDisplayAmount as formatIntegerAmount,
} from "@/app/utils/format";

const props = defineProps<{
  order: any;
  orderId: string;
  payment: any;
  selectedAsset?: string;
  selectedNetwork?: string;
  selectedOption?: pay.CheckoutOption;
  show: boolean;
}>();

const emit = defineEmits<{
  submitted: [];
  "update:show": [show: boolean];
}>();

const message = useMessage();
const { t } = useI18n();
const answers = ref<Record<string, string>>({});
const image = ref("");
const imageName = ref("");
const loading = ref(false);
const returnStep = ref(0);
const step = ref(0);
const txid = ref("");

const visible = computed({
  get: () => props.show,
  set: (show) => emit("update:show", show),
});
const questions = computed(() => {
  const asset = pay.assetKey(props.payment?.currency || props.selectedAsset || "usdt");
  const network = pay.networkKey(props.payment?.driver || props.selectedNetwork || "trc20");
  const amount = Number(props.payment?.amount || props.selectedOption?.amount || props.order?.amount || 0);
  const networkCorrect = pay.networkName(network);
  const assetCorrect = pay.assetName(asset);
  const amountCorrect = `${formatExactAmount(amount)} ${assetCorrect}`;
  return [
    {
      correct: networkCorrect,
      id: "network",
      options: options(networkCorrect, pay.reviewNetworkOptions()),
      risk: t("review.network_risk", { network: networkCorrect }),
      title: t("review.network_question"),
    },
    {
      correct: assetCorrect,
      id: "asset",
      options: options(assetCorrect, pay.reviewAssetOptions()),
      risk: t("review.asset_risk", { asset: assetCorrect }),
      title: t("review.asset_question"),
    },
    {
      correct: amountCorrect,
      id: "amount",
      options: amountOptions(amount, assetCorrect, amountCorrect),
      risk: t("review.amount_risk"),
      title: t("review.amount_question"),
    },
  ];
});
const question = computed(() => questions.value[step.value]);
const credentialStep = computed(() => step.value >= questions.value.length);
const finalRisk = computed(() => {
  const wrong = questions.value.find((item) => answers.value[item.id] && answers.value[item.id] !== item.correct);
  return `${wrong?.risk ?? t("review.network_issue")}\n\n${t("review.upload_help_suffix")}`;
});
const canNext = computed(() => Boolean(question.value && answers.value[question.value.id]));
const canSubmit = computed(() => credentialStep.value && Boolean(txid.value.trim()) && Boolean(image.value));

watch(() => props.show, (show) => {
  if (show) reset();
});

function reset() {
  answers.value = {};
  image.value = "";
  imageName.value = "";
  returnStep.value = 0;
  step.value = 0;
  txid.value = "";
}

function choose(questionId: string, answer: string) {
  answers.value = { ...answers.value, [questionId]: answer };
}

function next() {
  const item = question.value;
  if (!item || !answers.value[item.id]) {
    message.warning(t("review.choose_answer"));
    return;
  }
  returnStep.value = step.value;
  if (answers.value[item.id] !== item.correct || step.value >= questions.value.length - 1) {
    step.value = questions.value.length;
    return;
  }
  step.value += 1;
}

function previous() {
  if (credentialStep.value) {
    step.value = returnStep.value;
    return;
  }
  step.value = Math.max(0, step.value - 1);
}

async function upload(options: { file: { file?: File | null }; onError?: () => void; onFinish?: () => void }) {
  const file = options.file.file;
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    message.warning(t("review.upload_image_first"));
    options.onError?.();
    return;
  }
  if (file.size > 2_000_000) {
    message.warning(t("review.image_too_large"));
    options.onError?.();
    return;
  }
  try {
    imageName.value = file.name;
    image.value = await fileToWebp(file);
    options.onFinish?.();
  } catch {
    options.onError?.();
  }
}

async function submit() {
  if (!txid.value.trim()) {
    message.warning(t("review.tx_required"));
    return;
  }
  if (!image.value) {
    message.warning(t("review.screenshot_required"));
    return;
  }
  loading.value = true;
  try {
    await api.checkout.review(props.orderId, {
      answer: answerText(),
      image: image.value,
    });
    visible.value = false;
    emit("submitted");
    message.success(t("review.submitted"));
  } finally {
    loading.value = false;
  }
}

function answerText() {
  return [
    ...questions.value.map((item) => `${item.title}\n${answers.value[item.id] || t("review.not_asked")}`),
    `${t("review.tx_label")}\n${txid.value.trim()}`,
  ].join("\n\n");
}

function fileToWebp(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/webp", 0.86));
    };
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error("image_load_failed"));
    };
    image.src = URL.createObjectURL(file);
  });
}

function options(correct: string, candidates: string[]) {
  const distractors = shuffle(candidates.filter((item) => item !== correct)).slice(0, 3);
  return shuffle([correct, ...distractors]);
}

function amountOptions(amount: number, asset: string, correct: string) {
  const wrong = Number.isInteger(ceilDisplayAmount(amount))
    ? [
        `${formatExactAmount(amount + 1)} ${asset}`,
        `${formatExactAmount(amount - 1.5)} ${asset}`,
        `${formatExactAmount(amount - 0.2)} ${asset}`,
      ]
    : [
        `${formatIntegerAmount(amount)} ${asset}`,
        `${formatExactAmount(amount - 1.5)} ${asset}`,
        `${formatExactAmount(amount - 0.2)} ${asset}`,
      ];
  return shuffle([correct, ...wrong]);
}

function shuffle(items: string[]) {
  return [...new Set(items)].sort((left, right) => score(left) - score(right));
}

function score(value: string) {
  let out = props.orderId.length;
  for (let index = 0; index < value.length; index += 1) {
    out = (out * 31 + value.charCodeAt(index)) % 997;
  }
  return out;
}
</script>

<template>
  <n-modal v-model:show="visible">
    <n-card
      closable
      class="checkout-review-modal"
      :title="t('review.title')"
      role="dialog"
      aria-modal="true"
      @close="visible = false"
    >
      <div class="checkout-review-form">
        <template v-if="!credentialStep && question">
          <div class="checkout-review-question">
            <strong>{{ question.title }}</strong>
            <div class="checkout-review-options">
              <button
                v-for="option in question.options"
                :key="option"
                :class="{ 'is-active': answers[question.id] === option }"
                type="button"
                @click="choose(question.id, option)"
              >
                {{ option }}
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <div v-if="finalRisk" class="checkout-review-help">
            <p>{{ finalRisk }}</p>
          </div>
          <n-input
            v-model:value="txid"
            :placeholder="t('review.tx_label')"
          />
          <n-upload
            accept="image/*"
            :custom-request="upload"
            directory-dnd
            :max="1"
            :show-file-list="false"
          >
            <n-upload-dragger>
              <div class="checkout-upload-dragger">
                <strong>{{ imageName || t('review.upload_screenshot') }}</strong>
                <span>{{ t('review.screenshot_help') }}</span>
              </div>
            </n-upload-dragger>
          </n-upload>
        </template>
      </div>
      <template #footer>
        <div class="modal-actions">
          <n-button v-if="step === 0" @click="visible = false">{{ t('common.cancel') }}</n-button>
          <n-button v-else @click="previous">{{ t('review.previous') }}</n-button>
          <n-button v-if="!credentialStep" :disabled="!canNext" type="primary" @click="next">{{ t('review.next') }}</n-button>
          <n-button v-else :disabled="!canSubmit" :loading="loading" type="primary" @click="submit">{{ t('review.submit_review') }}</n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isCallActive = false;
  @state() status = '';
  @state() error = '';

  private client: GoogleGenAI;
  private session: Session | null = null; // Initialize as null
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null; // Corrected type
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white; /* Added for better visibility */
      font-family: sans-serif; /* Added for better readability */
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      /* Changed to row for horizontal button layout */
      flex-direction: row; 
      gap: 20px; /* Increased gap for row layout */

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: auto; /* Auto width for text */
        height: 64px;
        cursor: pointer;
        font-size: 18px; /* Adjusted font size */
        padding: 0 20px; /* Padding for text */
        margin: 0;
        display: flex; 
        align-items: center; 
        justify-content: center;
        gap: 8px; /* Gap between icon and text */

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        /* Keep disabled buttons visible but indicate disabled state */
        opacity: 0.5;
        cursor: not-allowed;
        /* display: none; */ /* Removed to keep them visible */
      }
    }
  `;

  constructor() {
    super();
    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    this.outputNode.connect(this.outputAudioContext.destination);
    this.prepareAudioContexts();
  }

  private prepareAudioContexts() {
    this.nextStartTime = 0;
    if (this.inputAudioContext.state === 'suspended') {
      this.inputAudioContext.resume();
    }
    if (this.outputAudioContext.state === 'suspended') {
      this.outputAudioContext.resume();
    }
  }

  private async initSession() {
    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        console.warn("Error closing previous session:", e);
      }
      this.session = null;
    }

    for (const source of this.sources.values()) {
      try {
        source.stop();
      } catch (e) {
        console.warn("Error stopping audio source during initSession:", e);
      }
      this.sources.delete(source);
    }
    this.nextStartTime = this.outputAudioContext.currentTime;

    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Call connected.');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts?.[0]?.inlineData; // Optional chaining for parts

            if (audio && this.outputAudioContext.state === 'running') {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () =>{
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if(interrupted) {
              for(const source of this.sources.values()) {
                try {
                  source.stop();
                } catch (e) {
                  console.warn("Error stopping source on interrupt:", e);
                }
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus(`Call closed: ${e.reason || 'Unknown reason'}`);
            this.isCallActive = false; // Ensure state reflects closure
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Laomedeia'}},
            languageCode: 'ar-EG'
          },
          systemInstruction: `تعليمات نظام المساعد الصوتي لمركز ميد آرت
الهوية والأسلوب:

الدور: سكرتيرة عيادة "ميد آرت" الافتراضية.

اللغة: العربية الفصحى الواضحة والاحترافية.

اللهجة: أردنية احترافية شبه رسمية وواضحة. يجب أن تكون اللهجة طبيعية وتعكس المهنية والود الأردني.

النمط: مهني، ودود، متعاون، ومهذب للغاية. حافظ على نبرة صوت مطمئنة وإيجابية طوال المكالمة.

الهدف الأساسي: تقديم معلومات دقيقة وشاملة حول خدمات المركز، الإجابة عن استفسارات العملاء بوضوح، وتوجيههم نحو الخطوات التالية (الحجز، الاستشارة).

الدقة والإيجاز: كن موجزاً في إجاباتك ولكن لا تخل بالمعلومات الأساسية. لا تستخدم صيغة "أنا" ولكن اجعل الردود كأنها من شخصية السكرتيرة مباشرة.

مقدمة عن مركز ميد آرت
التعريف: مركز ميد آرت هو مركز طبي متخصص في زراعة الشعر وعلاج مشاكل البشرة.

التأسيس: تأسس عام 2019 في عمّان.

المميزات: يتميز المركز بنتائج حقيقية بنسبة 100% ومصداقية عالية في تقديم الخدمات، بقيادة فريق طبي محترف برئاسة الدكتور معن الصمادي.

معلومات عن الدكتور معن الصمادي
الاسم: الدكتور معن محمد الصمادي.

الجنسية: أردني.

تاريخ الميلاد: 1990.

الاختصاص: زراعة الشعر.

الشهادات والخبرة:

يتمتع بخبرة تزيد عن 7 سنوات في مجال زراعة الشعر.

أصبح متخصصاً ومهيئاً في هذا المجال نتيجة تجربته الشخصية مع الصلع الوراثي، مما جعله من أبرز الأطباء المهرة في هذا المجال داخل الأردن.

الخدمات المقدمة في مركز ميد آرت
أولاً: قسم زراعة الشعر
خدمات زراعة الشعر:

زراعة شعر الرأس، الحواجب، واللحية.

يتم تحديد عدد الجرافتات المطلوبة (عادةً بين 2000 إلى 5000 جرافت) حسب المساحة.

يتم عدّ البصيلات أمام المريض لضمان أعلى مستويات المصداقية والشفافية.

مميزات زراعة الشعر في المركز:

فريق طبي محترف لضمان أفضل تجربة.

الشفافية والمصداقية في جميع خطوات الزراعة.

متابعة شاملة للمريض قبل وبعد العملية.

الالتزام بزراعة العدد المتفق عليه من البصيلات.

توفير حقيبة علاجية شاملة (أدوية، شامبو، لوشن) بعد العملية.

جلسات غسيل خاصة بعد العملية.

تقديم تعليمات دقيقة من قبل الطاقم الطبي.

وجود مختبر طبي داخلي لإجراء الفحوصات اللازمة قبل العملية.

علاج مشاكل الشعر:

علاج البلازما (PRP): يتم فصل البلازما الغنية بالصفائح الدموية من دم المريض وحقنها في فروة الرأس لتحفيز نمو الشعر.

الميزوثيرابي: علاج مخصص لتساقط الشعر ومشكلات فروة الرأس المختلفة مثل القشرة، الثعلبة، والجفاف.

فيلر الشعر: لتحسين كثافة وملمس الشعر باستخدام مواد مغذية ومرطبة مثل حمض الهيالورونيك.

ثانياً: قسم العناية بالبشرة
الخدمات المقدمة في قسم العناية بالبشرة:

البوتوكس لإزالة التجاعيد.

الفيلر لملء الشفاه والخدين وتحديد الوجه.

تنظيف البشرة العميق (Hydrofacial) لتجديد نضارة البشرة.

إبر النضارة لتحسين جودة البشرة وإشراقها.

البلازما والميزوثيرابي المستخدمة أيضاً لتحسين شباب البشرة ونضارتها.

باقات وأسعار زراعة الشعر
ملاحظة هامة: عند ذكر الأسعار، يجب دائماً ذكر أن طريقة الدفع ميسرة وتتوفر خيارات الدفع نقداً أو بالأقساط.

باقة مقدمة الرأس:

الكلفة: 600 دينار أردني.

عدد البصيلات: 2500 بصيلة.

عدد الجلسات: جلسة واحدة للزراعة.

جلسات البلازما (PRP): 5 جلسات.

الخدمات المشمولة: علاجات طبية، فحوصات مخبرية، ضيافة داخلية، وشهادة ضمان مكتوبة.

باقة نصف الرأس:

الكلفة: 800 دينار أردني.

عدد البصيلات: 3500 بصيلة.

عدد الجلسات: جلسة واحدة للزراعة.

جلسات البلازما (PRP): 7 جلسات.

الخدمات المشمولة: نفس الخدمات المشمولة في باقة مقدمة الرأس (علاجات طبية، فحوصات مخبرية، ضيافة داخلية، شهادة ضمان).

باقة المنطقة الخلفية كاملة مع التاج:

الكلفة: 1000 دينار أردني.

عدد البصيلات: 5000 بصيلة.

عدد الجلسات: جلسة واحدة للزراعة.

جلسات البلازما (PRP): 8 جلسات.

الخدمات المشمولة: نفس الخدمات المشمولة في الباقات السابقة (علاجات طبية، فحوصات مخبرية، ضيافة داخلية، شهادة ضمان).

طريقة الدفع
ملاحظة هامة: يجب ذكر أن طريقة الدفع في ميد آرت ميسرة للجميع، وتتوفر خيارات الدفع نقداً أو بالأقساط، في كل مرة يتم فيها الاستفسار عن الأسعار أو الدفع.

خيارات الدفع المتاحة:

نقداً: الدفع الكلي للمبلغ المتفق عليه.

بالأقساط: تتوفر عدة خيارات للأقساط:

عبر بنك الاتحاد:

يجب أن يكون العميل مسجلاً في بنك الاتحاد.

يتم توجيه العميل للتنسيق مع البنك مباشرة.

عبر شركة وصلة:

لا تتطلب دفعة أولى.

الشروط: يتطلب الأمر توفير كشف راتب أو كفيل مشترك ضمان أو كشف راتب حكومي.

للاستفسار عن شركة وصلة: يمكن التواصل معهم مباشرة على الرقم: 00962798191111.

عبر المركز مباشرة:

يتم دفع نصف المبلغ يوم العملية.

يتم تقسيط المبلغ المتبقي على أقساط شهرية تتراوح بين 70 - 100 دينار من خلال كمبيالات للمركز.

أسعار الأقساط (هذه الأسعار تختلف قليلاً عن الدفع النقدي):

مقدمة الرأس: 600 دينار أردني.

منطقة نصف الرأس: 850 دينار أردني.

المنطقة العلوية كاملة مع التاج: 1100 دينار أردني.

الأسئلة الشائعة والإجابات (تجب الإجابة عليها مباشرة)
أسئلة حول مدى ملاءمة زراعة الشعر (هذه الأسئلة تتطلب جمع معلومات من العميل)
عندما يسأل العميل: "هل زراعة الشعر مناسبة لي؟"

الرد الأولي: "لتحديد مدى ملاءمة زراعة الشعر لحالتك، نحتاج لجمع بعض المعلومات الأساسية التي سيتم إرسالها للطبيب المختص. هل يمكنني أن أطرح عليك بعض الأسئلة؟"

الأسئلة التي يجب طرحها بالتسلسل:

"ما اسمك الكريم؟"

"كم عمرك؟"

"هل أنت ذكر أم أنثى؟"

"هل أنت مدخن؟"

"هل تعاني من حساسية تجاه أي أدوية؟"

"إذا كنتِ أنثى، هل أنتِ حامل حالياً؟"

"هل لديك أي مشاكل صحية معروفة؟"

"ما هو رقم هاتفك للتواصل معك؟"

الرد بعد جمع المعلومات: "شكراً جزيلاً على معلوماتك، سيتم إرسال استفسارك مباشرةً للطبيب المختص، وسنقوم بالرد عليك قريباً جداً عبر الهاتف أو الواتساب لتحديد مدى ملاءمة الزراعة لحالتك بناءً على تقييم الطبيب."

الفحوصات المطلوبة
للزراعة الشعر:

CBC

Pt/INR

Urea + Creatinine

AST + ALT

HBsAg

HCV

HIV

TSH

Ferritin

ESR

CRP

للبلازما (PRP):

CBC

TSH

Ferritin

Mg

H.pylori IgG

Zinc

أسئلة شائعة عامة عن زراعة الشعر
متى يمكنني العودة للعمل؟

العودة للعمل ممكنة خلال 2-7 أيام حسب التقنية المستخدمة وحالة الشخص.

هل ستكون النتائج دائمة؟

نعم، البصيلات المزروعة مأخوذة من منطقة مقاومة لتساقط الشعر (المنطقة المانحة)، مما يجعل النتائج دائمة في معظم الحالات.

هل هناك ألم أثناء العملية؟

العمليات تُجرى تحت تخدير موضعي، مما يجعلها خالية من الألم تقريباً. قد تشعر ببعض الضغط أو الانزعاج البسيط.

متى تبدأ النتائج بالظهور؟

تظهر النتائج الأولية خلال 3-4 أشهر، وتكون النتيجة النهائية واضحة بعد 12-18 شهراً.

أسئلة عامة عن زراعة الشعر
ما هي زراعة الشعر؟

زراعة الشعر هي إجراء طبي يتم فيه نقل بصيلات الشعر من منطقة مانحة (عادةً خلف الرأس أو جوانبه) إلى منطقة تعاني من الصلع أو التساقط.

من هو المرشح المناسب لزراعة الشعر؟

الأشخاص الذين لديهم مناطق مانحة قوية ويعانون من تساقط الشعر الوراثي أو فقدان الشعر الموضعي.

هل زراعة الشعر دائمة؟

نعم، لأن الشعر المزروع مأخوذ من مناطق مقاومة للتساقط.

هل يمكن إجراء زراعة الشعر للنساء؟

نعم، خاصة للنساء اللواتي يعانين من تساقط الشعر الوراثي أو الفراغات المحددة.

هل زراعة الشعر آمنة؟

نعم، بشرط أن تُجرى على يد طبيب متخصص وفي مركز معتمد وذو سمعة جيدة.

ما العمر المناسب لزراعة الشعر؟

يُفضل إجراء العملية بعد سن 25 عاماً لضمان استقرار تساقط الشعر.

هل زراعة الشعر مؤلمة؟

الإجراء يتم تحت تخدير موضعي، مما يجعله غير مؤلم.

كم تستغرق عملية زراعة الشعر؟

تستغرق العملية من 4 إلى 8 ساعات، حسب عدد البصيلات والتقنية المستخدمة.

هل تظهر ندوب بعد العملية؟

تقنية FUE وDHI لا تترك ندوباً واضحة، بل نقاطاً صغيرة تختفي مع مرور الوقت، مقارنةً بتقنية FUT التي قد تترك ندبة خطية.

ما هي الفحوصات اللازمة قبل العملية؟

تشمل فحوصات الدم مثل CBC، PT/INR، وظائف الكبد والكلى، وفحص الأمراض المعدية (اذكر الفحوصات المذكورة في قسم "الفحوصات المطلوبة" بشكل مفصل إذا طلب العميل).

أسئلة حول التحضير للعملية
كيف أستعد لعملية زراعة الشعر؟

يجب التوقف عن التدخين والأدوية المميعة للدم (مثل الأسبرين) واتباع تعليمات الطبيب بدقة.

هل يمكنني تناول الطعام قبل العملية؟

نعم، يُفضل تناول وجبة خفيفة قبل الإجراء.

هل أحتاج إلى شخص يرافقني؟

يفضل ذلك لتسهيل التنقل والراحة بعد العملية.

كم مرة أحتاج لغسل شعري قبل العملية؟

حسب إرشادات الطبيب، وعادةً يتم غسله جيداً في يوم العملية.

هل يجب التوقف عن الكحول؟

نعم، يجب التوقف عن تناول الكحول قبل أسبوع على الأقل من العملية.

أسئلة حول التقنيات المستخدمة
ما الفرق بين FUE وFUT؟

FUE (الاقتطاف) تعتمد على استخراج البصيلات فردياً، بينما FUT (الشريحة) تعتمد على استخراج شريط جلدي يحتوي على البصيلات.

ما هي تقنية DHI؟

هي تقنية تستخدم قلماً خاصاً (قلم تشوي) لزرع البصيلات مباشرة دون فتح قنوات مسبقاً، مما يوفر دقة عالية.

ما هي تقنية السفير؟

هي تقنية FUE لكنها تستخدم أقلاماً ذات رؤوس من حجر السفير لفتح قنوات دقيقة في فروة الرأس، مما يعزز الكثافة والمظهر الطبيعي.

هل تقنية DHI تتطلب حلق الرأس؟

لا، يمكن إجراؤها دون حلاقة كاملة للرأس، مما يجعلها مناسبة لمن لا يرغبون بحلاقة شعرهم بالكامل.

ما هي مزايا تقنية السفير؟

تسريع التعافي، تحسين الكثافة بشكل ملحوظ، والحصول على مظهر طبيعي جداً.

أسئلة عن ما بعد العملية
كم من الوقت يستغرق التعافي؟

من 7-10 أيام للتعافي الأولي، والنتائج النهائية تظهر خلال 12-18 شهراً.

متى يمكنني العودة للعمل؟

يمكن العودة للعمل خلال 2-5 أيام حسب التقنية المستخدمة وطبيعة العمل.

متى يبدأ الشعر المزروع بالنمو؟

يبدأ الشعر المزروع بالنمو خلال 3-4 أشهر، مع تحسن ملحوظ في الكثافة والمظهر حتى 18 شهراً.

هل الشعر المزروع يتساقط؟

نعم، يحدث تساقط مؤقت للشعر المزروع (يُعرف بتساقط الصدمة) في الأسابيع الأولى بعد العملية، وهذا طبيعي جداً قبل بدء النمو الدائم.

هل يمكنني ممارسة الرياضة بعد العملية؟

يُفضل تجنب الأنشطة الرياضية الشاقة لمدة شهرين بعد العملية.

أسئلة عن علاجات الشعر الإضافية
ما هو PRP؟

PRP هو حقن البلازما الغنية بالصفائح الدموية لتحفيز نمو الشعر وتحسين كثافته، وهو علاج طبيعي يعتمد على دم المريض نفسه.

هل يمكن الجمع بين PRP وزراعة الشعر؟

نعم، يمكن دمج جلسات PRP مع زراعة الشعر لتحفيز نمو الشعر المزروع وتحسين النتائج بشكل عام.

ما هو الميزوثيرابي؟

الميزوثيرابي هو علاج لتحسين صحة فروة الرأس وتقليل تساقط الشعر عن طريق حقن الفيتامينات والمعادن مباشرة في الفروة.

ما هو فيلر الشعر؟

فيلر الشعر هو حقن تحتوي على مواد مغذية تهدف إلى تحسين كثافة الشعر وملمسه وزيادة حيويته.

هل تحتاج هذه العلاجات إلى تخدير؟

لا، معظم هذه العلاجات (PRP، الميزوثيرابي، الفيلر) غير مؤلمة ولا تتطلب تخديراً.

أسئلة عن التكلفة والدفع
ما تكلفة زراعة الشعر؟

تبدأ تكلفة زراعة الشعر من 600 دينار أردني حسب عدد البصيلات والمنطقة المراد زراعتها. (تذكر دائماً خيارات الدفع النقدية والتقسيط).

هل هناك خيارات دفع بالتقسيط؟

نعم، تتوفر خيارات دفع ميسرة عبر بنك الاتحاد وشركة وصلة، بالإضافة إلى الأقساط المباشرة مع المركز. (اذكر تفاصيل كل خيار إذا طلب العميل).

هل تشمل التكلفة جلسات البلازما؟

نعم، جميع باقات زراعة الشعر في مركز ميد آرت تشمل جلسات PRP لتحسين النتائج.

هل الحقيبة العلاجية مشمولة؟

نعم، الحقيبة العلاجية الشاملة التي تتضمن الشامبو والأدوية واللوشن مشمولة ضمن تكلفة الباقة.

هل هناك ضمان على النتائج؟

نعم، مركز ميد آرت يقدم ضماناً مكتوباً على نتائج زراعة الشعر لضمان راحة بالك.

أسئلة عن النساء والأطفال
هل زراعة الشعر مناسبة للنساء؟

نعم، زراعة الشعر مناسبة جداً للنساء، خاصة في حالات تساقط الشعر الوراثي أو لتعبئة الفراغات المحددة.

هل يمكن زراعة الشعر للأطفال؟

نادراً جداً، وتُجرى فقط في حالات طبية خاصة جداً بعد استشارة الطبيب المختص.

هل الحمل يؤثر على زراعة الشعر؟

يُفضل تأجيل زراعة الشعر حتى بعد فترة الحمل والإرضاع لضمان أفضل النتائج وسلامة الأم والجنين.

هل يمكن علاج تساقط الشعر عند النساء بدون زراعة؟

نعم، يمكن علاج تساقط الشعر عند النساء بفعالية من خلال علاجات مثل PRP، الميزوثيرابي، أو فيلر الشعر.

هل يجب حلق الشعر للنساء؟

ليس بالضرورة، خاصة مع تقنيات مثل DHI التي تسمح بالزراعة دون الحاجة لحلاقة كاملة للرأس.

أسئلة إضافية وتقنية
هل يمكن زراعة الحواجب؟

نعم، مركز ميد آرت يقدم خدمات زراعة الحواجب بتقنيات دقيقة لتعزيز كثافة وشكل الحواجب.

هل يمكن زراعة اللحية؟

نعم، تتوفر خدمة زراعة اللحية، ويتم تصميم شكل اللحية وكثافتها حسب رغبة المريض.

ما هي الخلايا الجذعية للشعر؟

الخلايا الجذعية للشعر هي علاج مبتكر لتحفيز نمو الشعر باستخدام خلايا الجسم الذاتية للمريض، وتهدف إلى تجديد بصيلات الشعر.

هل يمكن السباحة بعد العملية؟

يُنصح بتجنب السباحة لمدة 3 أشهر بعد عملية زراعة الشعر.

هل تؤثر الحرارة على الشعر المزروع؟

يجب تجنب التعرض المفرط للشمس المباشرة أو الحرارة العالية (مثل الساونا أو مجففات الشعر الحارة) بعد العملية لعدة أسابيع.

أسئلة عن المخاطر والمتابعة
هل هناك مضاعفات طويلة الأمد؟

نادراً ما تحدث مضاعفات طويلة الأمد إذا أُجريت العملية تحت إشراف طبيب مختص وفي بيئة طبية آمنة.

هل يجب المتابعة مع الطبيب بعد العملية؟

نعم، يوصى بزيارات متابعة منتظمة؛ عادةً تكون هناك زيارة متابعة خلال الأسبوع الأول وبعد 6-12 شهراً لتقييم النتائج.

ما هي الأعراض التي تتطلب استشارة الطبيب؟

أي احمرار مفرط، تورم كبير وغير طبيعي، ألم مستمر وشديد، أو علامات عدوى (مثل خروج إفرازات) تتطلب استشارة فورية للطبيب.

هل يمكن إزالة الشعر المزروع؟

لا يمكن إزالته بسهولة بعد الزراعة لأنه يصبح جزءاً حيوياً من فروة الرأس وينمو بشكل طبيعي.

هل يمكن زراعة الشعر أكثر من مرة؟

نعم، إذا كانت المنطقة المانحة للشعر كافية وتسمح بإجراء عملية زراعة أخرى، فيمكن تكرارها.

معلومات التواصل مع مركز ميد آرت
العنوان: شارع المدينة المنورة، عمّان، الأردن.

رقم الهاتف: 00962796961141.

ساعات العمل:

السبت - الخميس: من 9 صباحاً إلى 5 مساءً.

الجمعة: مغلق.

رابط الحجز والاستشارة: لا يوجد رابط فعلي للاستخدام المباشر من قبل الوكيل الصوتي، لذا في حال سؤال العميل عن الرابط، يجب توجيهه للاتصال على الرقم أو زيارة الموقع للحجز. قل: "يمكنك التواصل معنا على الرقم 00962796961141 للحجز أو الاستشارة، أو زيارة موقعنا الإلكتروني."

إرشادات تفاعلية إضافية للوكيل الصوتي
التعامل مع الاستفسارات غير المعروفة: إذا كان السؤال خارج نطاق المعرفة المتاحة لديك كوكيل افتراضي، قل بلباقة ومهنية: "هذا السؤال خارج نطاق المعلومات المتاحة لدي كوكيل افتراضي حالياً، لكن يسعدني أن أحولك لموظف خدمة العملاء في مركز ميد آرت ليجيبك بشكل أفضل." أو "بإمكانك التواصل معنا مباشرة على الرقم 00962796961141 للحصول على معلومات إضافية."

التوضيح والتأكيد: إذا كان طلب العميل غامضاً أو غير واضح، اطلب التوضيح بأسلوب مهذب: "هل يمكنك توضيح استفسارك قليلاً لأتمكن من تقديم المساعدة المطلوبة بشكل دقيق؟"

دعوة لاتخاذ إجراء (Call to Action): بعد تقديم المعلومات، شجع العميل دائماً على الخطوة التالية، مثلاً: "نتطلع لخدمتك في مركز ميد آرت. للحجز أو لتحديد موعد استشارة مجانية مع الدكتور معن، يرجى الاتصال بنا على الرقم 00962796961141."

اللهجة الأردنية: حافظ على النبرة والتعابير الأردنية شبه الرسمية في جميع الردود لتعكس الهوية المحلية للمركز.

السرية: عند جمع معلومات شخصية، طمئن العميل بأن هذه المعلومات ستستخدم فقط لغرض الاستشارة الطبية وستتم مشاركتها مع الفريق الطبي المختص فقط.

الاستشارة ليست تشخيصاً: عند الإجابة عن أسئلة مثل "هل زراعة الشعر مناسبة لي؟"، وضح أن الإجابة هي جمع معلومات للاستشارة مع الطبيب وليس تشخيصاً طبياً مباشراً من الوكيل الصوتي.`
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError((e as Error).message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = ''; // Clear error when status updates
  }

  private updateError(msg: string) {
    this.error = `Error: ${msg}`;
    this.status = ''; // Clear status when error occurs
  }

  private async startCall() {
    if (this.isCallActive) {
      return;
    }
    this.updateStatus('Starting call...');
    this.prepareAudioContexts();

    try {
      await this.initSession();
      
      this.updateStatus('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      this.mediaStream = stream; // Assign to class member

      this.updateStatus('Microphone access granted. Capturing audio...');

      if (!this.mediaStream) {
        this.updateError("Failed to get media stream.");
        this.endCall();
        return;
      }

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isCallActive || !this.session) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination); // Optional for local echo

      this.isCallActive = true;
      // Status will be updated by initSession's onopen callback
    } catch (err) {
      console.error('Error starting call:', err);
      this.updateError((err as Error).message);
      this.endCall(); 
    }
  }

  private endCall() {
    if (!this.isCallActive && !this.mediaStream && !this.session && this.status !== 'Ending call...') {
       // If already ended or nothing to end, prevent multiple calls
      if (this.status === 'Call ended. Click Start Call to begin again.') return;
    }

    this.updateStatus('Ending call...');
    this.isCallActive = false;

    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode.onaudioprocess = null; // Remove listener
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }
    
    for(const source of this.sources.values()) {
      try {
        source.stop();
      } catch(e) {
        console.warn("Error stopping playback source during endCall:", e);
      }
      this.sources.delete(source);
    }
    this.nextStartTime = 0;

    this.updateStatus('Call ended. Click Start Call to begin again.');
  }

  render() {
    return html`
      <div>
        <div class="controls" role="toolbar" aria-label="Audio controls">
          <button
            id="startCallButton"
            @click=${this.startCall}
            ?disabled=${this.isCallActive}
            aria-label="Start Call">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.57c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-2.43c0-.54-.45-.99-.99-.99z"/></svg>
            Start Call
          </button>
          <button
            id="endCallButton"
            @click=${this.endCall}
            ?disabled=${!this.isCallActive}
            aria-label="End Call">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#c80000"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 9c-1.6 0-3.15.25-4.62.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 12.7c-.18-.18-.29-.43-.29-.71s.11-.53.29-.71l2.48-2.48c.18-.18.43-.29.71-.29.27 0 .52.11.7.28.72.79 1.55 1.47 2.48 2.02.33.17.72.09.96-.23l2.19-2.92C10.03 6.49 7.73 5.58 5.21 5.58c-.48 0-.93.11-1.33.3-.34.16-.75 0-1.02-.27l-1.1-1.1C1.58 4.33 1.33 4.23 1.05 4.23c-.27 0-.52.1-.7.28L0 4.87c-.19.19-.28.44-.28.7 0 .4.23.77.64 1.01C1.73 7.9 3.41 8.58 5.21 8.58c2.21 0 4.21-.66 5.97-1.82.19-.13.4-.2.62-.2.22 0 .43.07.62.2L17.3 9.6c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.72-1.47-1.55-2.02-2.48-.17-.33-.09-.72.23-.96l2.92-2.19c2.21 1.22 3.12 3.52 3.12 5.94 0 .48-.11.93-.3 1.33-.16.34 0 .75.27 1.02l1.1 1.1c.18.18.43.28.7.28.28 0 .53-.11.71-.29l.36-.36c.18-.18.29-.43.29-.71 0-.4-.23-.76-.64-1.01-1.31-.79-2.09-1.96-2.09-3.35z"/></svg>
            End Call
          </button>
        </div>

        <div id="status" role="status" aria-live="polite"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
// Add metadata.json for microphone permission
// This comment is for the prompter, not to be included in the file.
// If metadata.json needs to be created or updated, it would be a separate change.
// For now, only addressing the TS errors.
// A metadata.json file would look like this if microphone access is needed:
// {
//   "requestFramePermissions": [
//     "microphone"
//   ]
// }
// This app already requests microphone via navigator.mediaDevices.getUserMedia,
// so if a metadata.json is used by the platform, it should include "microphone".
// Since the prompt did not provide a metadata.json, I'm not creating/modifying one
// unless explicitly asked.
// The `process.env.GEMINI_API_KEY` is kept as is because the prompt states it's pre-configured.
// I've also updated error handling for `e.message` to `(e as Error).message` for better type safety.

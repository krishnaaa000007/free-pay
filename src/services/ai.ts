import type { Language, Role } from '../domain/types';
import { post } from './api';

/**
 * Free Pay assistant. Online it proxies through the server (which holds the OpenAI key).
 * Offline, or when the server has no key, it answers from a small built-in FAQ so the
 * feature never shows a dead end at the mela.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiContext {
  role?: Role;
  screen?: string;
  language?: Language;
  pending_sync?: number;
  online?: boolean;
}

interface FaqEntry {
  match: RegExp;
  answer: Record<Language, string>;
}

const FAQ: FaqEntry[] = [
  {
    match: /offline|network|signal|without internet|no internet|ऑफ़लाइन|नेटवर्क|ऑफलाइन|ઑફલાઇન|ஆஃப்லைன்/i,
    answer: {
      en: 'Offline payments work with a signed credential stored on your phone. The vendor scans your code and verifies the signature locally, no network needed. It syncs to the ledger when either phone is back online. Limit: ₹2,000 per payment, ₹5,000 per day.',
      hi: 'ऑफ़लाइन भुगतान आपके फ़ोन में रखे हस्ताक्षरित प्रमाण से होता है। दुकानदार कोड स्कैन कर हस्ताक्षर स्थानीय रूप से जाँचता है, नेटवर्क की ज़रूरत नहीं। ऑनलाइन आने पर यह सिंक होता है। सीमा: ₹2,000 प्रति भुगतान, ₹5,000 प्रति दिन।',
      mr: 'ऑफलाइन पेमेंट तुमच्या फोनमधील स्वाक्षरी केलेल्या प्रमाणपत्राने होते. दुकानदार कोड स्कॅन करून स्वाक्षरी स्थानिक तपासतो, नेटवर्क लागत नाही. ऑनलाइन आल्यावर सिंक होते. मर्यादा: ₹2,000 प्रति पेमेंट, ₹5,000 प्रति दिवस.',
      gu: 'ઑફલાઇન ચુકવણી તમારા ફોનમાં રાખેલા હસ્તાક્ષરિત પ્રમાણપત્રથી થાય છે. દુકાનદાર કોડ સ્કૅન કરી સહી સ્થાનિક ચકાસે છે, નેટવર્ક જરૂરી નથી. ઑનલાઇન થતાં સિંક થાય છે. મર્યાદા: ₹2,000 પ્રતિ ચુકવણી, ₹5,000 પ્રતિ દિવસ.',
      ta: 'ஆஃப்லைன் செலுத்தல் உங்கள் தொலைபேசியில் உள்ள கையொப்பமிட்ட சான்றால் வேலை செய்கிறது. கடைக்காரர் குறியீட்டை ஸ்கேன் செய்து கையொப்பத்தை உள்ளூரில் சரிபார்க்கிறார். ஆன்லைன் வந்தவுடன் ஒத்திசைக்கும். வரம்பு: ஒரு செலுத்தலுக்கு ₹2,000, ஒரு நாளுக்கு ₹5,000.',
    },
  },
  {
    match: /limit|maximum|how much|सीमा|मर्यादा|મર્યાદા|வரம்பு/i,
    answer: {
      en: 'Offline limits are ₹2,000 per payment and ₹5,000 in any rolling 24 hours. Online payments have no offline cap. Your offline credential is valid for 10 days; refresh it whenever you have signal.',
      hi: 'ऑफ़लाइन सीमा ₹2,000 प्रति भुगतान और 24 घंटे में ₹5,000 है। ऑनलाइन भुगतान पर ऑफ़लाइन सीमा नहीं। आपका प्रमाण 10 दिन मान्य है; सिग्नल मिलने पर नवीनीकृत करें।',
      mr: 'ऑफलाइन मर्यादा ₹2,000 प्रति पेमेंट आणि 24 तासांत ₹5,000 आहे. ऑनलाइन पेमेंटला ऑफलाइन मर्यादा नाही. तुमचे प्रमाणपत्र 10 दिवस वैध; सिग्नल मिळाल्यावर नूतनीकरण करा.',
      gu: 'ઑફલાઇન મર્યાદા ₹2,000 પ્રતિ ચુકવણી અને 24 કલાકમાં ₹5,000 છે. ઑનલાઇન ચુકવણી પર ઑફલાઇન મર્યાદા નથી. તમારું પ્રમાણપત્ર 10 દિવસ માન્ય; સિગ્નલ મળે ત્યારે નવીકરણ કરો.',
      ta: 'ஆஃப்லைன் வரம்பு ஒரு செலுத்தலுக்கு ₹2,000 மற்றும் 24 மணி நேரத்தில் ₹5,000. ஆன்லைன் செலுத்தலுக்கு ஆஃப்லைன் வரம்பு இல்லை. உங்கள் சான்று 10 நாட்கள் செல்லும்; சிக்னல் இருக்கும்போது புதுப்பியுங்கள்.',
    },
  },
  {
    match: /medical|doctor|hospital|ambulance|hurt|injur|चिकित्सा|डॉक्टर|अस्पताल|वैद्यकीय|તબીબી|மருத்துவ/i,
    answer: {
      en: 'Medical Post 3 is near Sector 4 Bazaar, north-west of Triveni Marg. For an emergency use the SOS button (hold 2 seconds) or call Ambulance 108. Your live location is shared with responders for 60 minutes.',
      hi: 'चिकित्सा चौकी 3 सेक्टर 4 बाज़ार के पास, त्रिवेणी मार्ग के उत्तर-पश्चिम में है। आपात स्थिति में SOS बटन (2 सेकंड दबाएँ) या एम्बुलेंस 108 पर कॉल करें। आपका स्थान 60 मिनट तक साझा रहता है।',
      mr: 'वैद्यकीय केंद्र 3 सेक्टर 4 बाजाराजवळ, त्रिवेणी मार्गाच्या वायव्येस आहे. आपत्कालात SOS बटण (2 सेकंद दाबा) किंवा रुग्णवाहिका 108 ला कॉल करा. तुमचे स्थान 60 मिनिटे शेअर होते.',
      gu: 'તબીબી ચોકી 3 સેક્ટર 4 બજાર પાસે, ત્રિવેણી માર્ગની ઉત્તર-પશ્ચિમે છે. આપત્તિમાં SOS બટન (2 સેકન્ડ દબાવો) કે એમ્બ્યુલન્સ 108 પર કૉલ કરો. તમારું સ્થાન 60 મિનિટ શેર રહે છે.',
      ta: 'மருத்துவ மையம் 3 செக்டர் 4 பஜார் அருகில், திரிவேணி மார்க்கின் வடமேற்கில் உள்ளது. அவசரத்திற்கு SOS பொத்தானை (2 வினாடி அழுத்தவும்) அல்லது ஆம்புலன்ஸ் 108 ஐ அழையுங்கள். உங்கள் இருப்பிடம் 60 நிமிடங்கள் பகிரப்படும்.',
    },
  },
  {
    match: /settle|payout|bank|money|सेटल|बैंक|सेटलमेंट|સેટલ|தீர்வு/i,
    answer: {
      en: 'Open the Settlement tab. Every synced payment becomes available there; tap "Request settlement" and the batch is paid to your registered bank account. Pending-sync payments settle after they sync.',
      hi: 'सेटलमेंट टैब खोलें। हर सिंक हुआ भुगतान वहाँ उपलब्ध होता है; "सेटलमेंट अनुरोध" दबाएँ और बैच आपके पंजीकृत बैंक खाते में जाता है। सिंक-बाकी भुगतान सिंक के बाद सेटल होते हैं।',
      mr: 'सेटलमेंट टॅब उघडा. प्रत्येक सिंक झालेले पेमेंट तिथे उपलब्ध होते; "सेटलमेंट विनंती" दाबा आणि बॅच तुमच्या नोंदणीकृत बँक खात्यात जाते. सिंक बाकी असलेली पेमेंट्स सिंकनंतर सेटल होतात.',
      gu: 'સેટલમેન્ટ ટૅબ ખોલો. દરેક સિંક થયેલી ચુકવણી ત્યાં ઉપલબ્ધ થાય છે; "સેટલમેન્ટ વિનંતી" દબાવો અને બૅચ તમારા નોંધાયેલા બૅન્ક ખાતામાં જાય છે. સિંક-બાકી ચુકવણી સિંક પછી સેટલ થાય છે.',
      ta: 'தீர்வு தாவலைத் திறக்கவும். ஒத்திசைந்த ஒவ்வொரு செலுத்தலும் அங்கே கிடைக்கும்; "தீர்வு கோரிக்கை" ஐ தட்டினால் தொகுப்பு உங்கள் பதிவு செய்த வங்கிக் கணக்கிற்கு செலுத்தப்படும். ஒத்திசைவு நிலுவை செலுத்தல்கள் ஒத்திசைந்த பின் தீர்வாகும்.',
    },
  },
  {
    match: /crowd|route|way|path|busy|भीड़|रास्ता|गर्दी|मार्ग|ભીડ|માર્ગ|கூட்டம்|வழி/i,
    answer: {
      en: 'Open Crowd map from Home. Red zones are at capacity; the "Find a calmer route" tool avoids them and shows an ETA. Sangam Ghat peaks 5-9 am and 5-8 pm; Arail Ghat is usually calmer.',
      hi: 'होम से भीड़ नक्शा खोलें। लाल क्षेत्र भरे हुए हैं; "शांत रास्ता खोजें" उन्हें बचाकर समय बताता है। संगम घाट सुबह 5-9 और शाम 5-8 में सबसे भीड़ होता है; अरैल घाट प्रायः शांत रहता है।',
      mr: 'होममधून गर्दी नकाशा उघडा. लाल क्षेत्रे भरलेली आहेत; "शांत मार्ग शोधा" ती टाळून वेळ दाखवते. संगम घाटावर सकाळी 5-9 आणि संध्याकाळी 5-8 सर्वाधिक गर्दी; अरैल घाट सहसा शांत असतो.',
      gu: 'હોમથી ભીડ નકશો ખોલો. લાલ વિસ્તારો ભરેલા છે; "શાંત માર્ગ શોધો" તેમને ટાળી સમય બતાવે છે. સંગમ ઘાટ સવારે 5-9 અને સાંજે 5-8 સૌથી ભીડવાળો; અરૈલ ઘાટ સામાન્ય રીતે શાંત.',
      ta: 'முகப்பிலிருந்து கூட்ட வரைபடத்தைத் திறக்கவும். சிவப்பு மண்டலங்கள் நிரம்பியுள்ளன; "அமைதியான வழி" கருவி அவற்றைத் தவிர்த்து நேரத்தைக் காட்டும். சங்கம் காட் காலை 5-9, மாலை 5-8 உச்சம்; அரைல் காட் பொதுவாக அமைதி.',
    },
  },
  {
    match: /lost|missing|child|गुम|खो|हरवल|ગુમ|காணாமல்/i,
    answer: {
      en: 'Use "Lost person" on Home: add a name, clothing details and where they were last seen. Volunteers and the control room see it instantly. You can also call Lost & Found at 1098.',
      hi: 'होम पर "गुमशुदा" चुनें: नाम, कपड़ों का विवरण और आख़िरी स्थान लिखें। स्वयंसेवक और नियंत्रण कक्ष इसे तुरंत देखते हैं। आप 1098 पर भी कॉल कर सकते हैं।',
      mr: 'होमवर "हरवलेली व्यक्ती" निवडा: नाव, कपड्यांचे तपशील आणि शेवटी दिसलेले ठिकाण लिहा. स्वयंसेवक आणि नियंत्रण कक्ष लगेच पाहतात. 1098 वर कॉलही करू शकता.',
      gu: 'હોમ પર "ગુમ વ્યક્તિ" પસંદ કરો: નામ, કપડાંની વિગત અને છેલ્લે જોયાનું સ્થાન લખો. સ્વયંસેવકો અને નિયંત્રણ કક્ષ તરત જુએ છે. 1098 પર કૉલ પણ કરી શકો.',
      ta: 'முகப்பில் "காணாமல் போனவர்" ஐப் பயன்படுத்துங்கள்: பெயர், உடை விவரம், கடைசியாகப் பார்த்த இடம். தன்னார்வலர்கள் மற்றும் கட்டுப்பாட்டு அறை உடனே பார்க்கும். 1098 ஐயும் அழைக்கலாம்.',
    },
  },
];

const FALLBACK: Record<Language, string> = {
  en: 'I can help with offline payments, limits, settlement, crowd routes and emergencies. Try asking "How do offline payments work?"',
  hi: 'मैं ऑफ़लाइन भुगतान, सीमा, सेटलमेंट, भीड़ मार्ग और आपात स्थिति में मदद कर सकता हूँ। पूछें: "ऑफ़लाइन भुगतान कैसे काम करता है?"',
  mr: 'मी ऑफलाइन पेमेंट, मर्यादा, सेटलमेंट, गर्दी मार्ग आणि आपत्कालात मदत करू शकतो. विचारा: "ऑफलाइन पेमेंट कसे चालते?"',
  gu: 'હું ઑફલાઇન ચુકવણી, મર્યાદા, સેટલમેન્ટ, ભીડ માર્ગ અને આપત્તિમાં મદદ કરી શકું. પૂછો: "ઑફલાઇન ચુકવણી કેવી રીતે ચાલે?"',
  ta: 'ஆஃப்லைன் செலுத்தல், வரம்புகள், தீர்வு, கூட்ட வழிகள், அவசரம் பற்றி உதவலாம். கேளுங்கள்: "ஆஃப்லைன் செலுத்தல் எப்படி வேலை செய்கிறது?"',
};

export function offlineAnswer(question: string, lang: Language = 'en'): string {
  const hit = FAQ.find((f) => f.match.test(question));
  return hit ? hit.answer[lang] ?? hit.answer.en : FALLBACK[lang] ?? FALLBACK.en;
}

export async function askAssistant(messages: ChatMessage[], ctx: AiContext): Promise<{ reply: string; source: 'server' | 'offline' }> {
  const last = messages[messages.length - 1]?.content ?? '';
  const lang = ctx.language ?? 'en';
  if (ctx.online === false) return { reply: offlineAnswer(last, lang), source: 'offline' };
  try {
    const r = await post<{ reply: string }>('/api/ai', { messages: messages.slice(-10), context: ctx }, { timeoutMs: 25_000 });
    if (r.reply) return { reply: r.reply, source: 'server' };
    return { reply: offlineAnswer(last, lang), source: 'offline' };
  } catch {
    return { reply: offlineAnswer(last, lang), source: 'offline' };
  }
}

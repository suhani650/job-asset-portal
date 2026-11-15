import { ROLES } from '../config/roles.js';

/* ---------------------------------------------------------------------------
   What the Assistant knows about the portal.
   - "Guide mode" (no AI key): the best matching topic below is returned.
   - "AI mode": the same facts are given to the AI model so it never invents features.
   Every topic has an English text (en) and a Hinglish text (hi).
--------------------------------------------------------------------------- */

const HR = ROLES.HR_MANAGER;
const OWN = ROLES.OWNER;
const REC = ROLES.RECRUITER;
const ALL = [OWN, HR, REC, ROLES.TRAINER, ROLES.EMPLOYEE];

// Buttons the Assistant may show. The AI may only choose from this list.
export const ACTIONS = {
  '/dashboard': { label: 'Open dashboard', roles: ALL },
  '/jobs': { label: 'Open Job Postings', roles: [OWN, HR, REC] },
  '/jobs/new': { label: 'Post a job', roles: [OWN, HR, REC] },
  '/candidates': { label: 'Find Candidates', roles: [OWN, HR, REC] },
  '/team': { label: 'Open Team & Roles', roles: [OWN, HR] },
  '/applicants': { label: 'Open Applicants', roles: [OWN, HR, REC] },
  '/interviews': { label: 'Open Interviews', roles: [OWN, HR, REC] },
  '/employees': { label: 'Open Employee Registry', roles: [OWN, HR] },
  '/profile': { label: 'Open My Profile', roles: ALL },
  '/support': { label: 'My tickets', roles: ALL },
  '/support?new=1': { label: 'Raise a support ticket', roles: ALL },
};

export const allowedActions = (role) =>
  Object.entries(ACTIONS).filter(([, a]) => a.roles.includes(role)).map(([to, a]) => ({ to, label: a.label }));

export const TOPICS = [
  {
    id: 'greeting',
    keywords: ['hello', 'hi there', 'hey', 'namaste', 'good morning', 'good afternoon', 'good evening', 'hii', 'helo', 'hi'],
    en: 'Hello! I am your Asset Portal assistant. I can help you post jobs, find candidates, manage your team, fix sign-in problems and more. What do you need help with?',
    hi: 'Namaste! Main aapka Asset Portal assistant hoon. Main job post karne, candidates dhundhne, team manage karne, sign-in ki problem theek karne jaise kaamon me help kar sakta hoon. Aapko kis cheez me help chahiye?',
    actions: ['/jobs/new', '/candidates'],
  },
  {
    id: 'thanks',
    keywords: ['thank you', 'thanks', 'thx', 'shukriya', 'dhanyavad', 'dhanyawad', 'great help', 'got it'],
    en: 'You are welcome! If anything else comes up, just ask. I am here whenever you need me.',
    hi: 'Aapka swagat hai! Kuch aur poochna ho to bejhijhak poochiye, main yahin hoon.',
    actions: [],
  },
  {
    id: 'capabilities',
    keywords: ['what can you do', 'how can you help', 'what do you do', 'what are you', 'kya kar sakte', 'kya help kar', 'tum kya', 'aap kya kar'],
    en: 'I can guide you through:\n1. Posting, editing and closing jobs\n2. Finding and shortlisting candidates\n3. Adding recruiters and other team members (HR Manager)\n4. Sign-in and password problems\n5. Your profile, photo and edit requests\n6. Registration status and documents\n\nFor account-specific problems I can open a support ticket for you.',
    hi: 'Main in kaamon me guide kar sakta hoon:\n1. Job post, edit aur close karna\n2. Candidates dhundhna aur shortlist karna\n3. Recruiter aur team members jodna (HR Manager)\n4. Sign-in aur password ki problem\n5. Profile, photo aur edit request\n6. Registration status aur documents\n\nAccount ki khaas problem ho to main aapke liye support ticket bhi bana sakta hoon.',
    actions: ['/jobs/new', '/candidates', '/support?new=1'],
  },
  {
    id: 'signin',
    keywords: ['cannot sign in', "can't sign in", 'cant sign in', 'cannot login', "can't login", 'cant login', 'unable to login', 'unable to sign in', 'login problem', 'sign in problem', 'sign in issue', 'login issue', 'invalid email or password', 'wrong password', 'login nahi', 'sign in nahi', 'signin nahi', 'login nhi', 'password galat', 'access nahi', 'not able to login'],
    en: 'Sign-in problems usually have one of these causes:\n1. **Use the contact person\'s official email**, not the company email, and the password you set while registering.\n2. Pick the correct tab on the sign-in page: **Client / HR** for company users.\n3. Your company must be **approved** by the Super Admin first.\n4. Team members (recruiter, trainer, employee) use the email and password their **HR Manager** created in Team & Roles.\n\nStill stuck? Ask the Super Admin to set a new password for your company, or raise a ticket and we will fix it.',
    hi: 'Sign-in ki problem aam taur par in wajahon se hoti hai:\n1. **Contact person ka official email** use karein, company email nahi, aur wahi password jo registration me banaya tha.\n2. Sign-in page par sahi tab chunein: company users ke liye **Client / HR**.\n3. Aapki company ko pehle Super Admin se **approve** hona zaroori hai.\n4. Team members (recruiter, trainer, employee) apne **HR Manager** ke diye email aur password se sign in karte hain (Team & Roles me bane hote hain).\n\nPhir bhi na chale to Super Admin se naya password set karwayein, ya ticket raise karein, hum theek kar denge.',
    actions: ['/support?new=1'],
    escalate: true,
  },
  {
    id: 'forgot_password',
    keywords: ['forgot my password', 'i forgot password', 'forgot password link', 'password bhul', 'password yaad nahi', 'reset code', 'otp for password', 'password otp'],
    en: 'If you forgot your own password:\n1. On the sign-in page click **Forgot password?**\n2. Type your sign-in email and press **Send me the code**.\n3. You get a **6-digit code by email** (valid 10 minutes).\n4. Type the code and choose a new password. Then sign in.\nThis works for every account: Owner, HR Manager, Recruiter, Trainer, Employee and candidates. If the email does not arrive, check Spam, or ask for a new code after 45 seconds.',
    hi: 'Apna password bhool gaye ho to:\n1. Sign-in page par **Forgot password?** par click karein.\n2. Sign-in email likhein aur **Send me the code** dabayein.\n3. Email me **6-digit code** aayega (10 minute tak chalega).\n4. Code daalein aur naya password chunein. Phir sign in karein.\nYe har account ke liye kaam karta hai. Email na aaye to Spam dekhein, ya 45 second baad naya code mangayein.',
    actions: [],
  },
  {
    id: 'schedule_interview',
    keywords: ['schedule interview', 'schedule an interview', 'interview schedule', 'interview kaise', 'interview set', 'interview code', 'verify candidate', 'candidate verify', 'otp corner', 'interview otp', 'interview email', 'fix interview'],
    en: 'To schedule an interview:\n1. Open **Applicants** and click the candidate.\n2. Press **Schedule interview**, choose the date, time and how it happens (in person, online or phone).\n3. Press **Schedule and email the candidate**. The candidate gets an **email** with the details and a **6-digit code**, and the same code shows on their My Job Applications page.\n4. When the candidate arrives, open **Interviews**, choose their name in the **OTP corner**, and type the code they tell you. If the code is wrong 5 times, check their ID card and use **Verify with ID**.\nYou can reschedule or cancel from the Interviews page. The candidate is emailed again.',
    hi: 'Interview schedule karne ke liye:\n1. **Applicants** kholein aur candidate par click karein.\n2. **Schedule interview** dabayein, date, time aur tareeka (in person, online ya phone) chunein.\n3. **Schedule and email the candidate** dabayein. Candidate ko **email** milega jisme details aur **6-digit code** hoga, wahi code unke My Job Applications page par bhi dikhega.\n4. Candidate aaye to **Interviews** kholein, **OTP corner** me unka naam chunein aur wo code daalein jo wo batayein. 5 baar galat ho to ID card dekhkar **Verify with ID** dabayein.\nReschedule ya cancel Interviews page se hota hai, candidate ko dobara email jata hai.',
    actions: ['/applicants', '/interviews'],
  },
  {
    id: 'employee_registry',
    keywords: ['employee registry', 'employee id', 'employee list', 'employee record', 'add employee', 'employee directory', 'hired candidate', 'emp id', 'employee register'],
    en: 'The **Employee Registry** keeps everyone who works with your company, each with an automatic ID like EMP-2026-0001.\n- A candidate you move to **Hired** on the Applicants board is added **by itself**.\n- You can also press **Add employee** to add someone by hand.\n- Change a person\'s status (probation, active, on notice, exited) with the pencil button.\n- Use **Export CSV** to download the list.\nOnly the Owner and HR Managers can open it.',
    hi: '**Employee Registry** me company ke saare logon ka record rehta hai, har ek ko automatic ID milti hai jaise EMP-2026-0001.\n- Applicants board par jise **Hired** karte hain wo **apne aap** jud jata hai.\n- **Add employee** dabakar kisi ko haath se bhi jod sakte hain.\n- Pencil button se status badlein (probation, active, on notice, exited).\n- List download karne ke liye **Export CSV** dabayein.\nSirf Owner aur HR Manager ise khol sakte hain.',
    actions: ['/employees', '/applicants'],
  },
  {
    id: 'owner_role',
    keywords: ['owner', 'who is owner', 'owner role', 'owner dashboard', 'hr manager vs owner', 'owner kaun'],
    en: 'The **Owner** is the person who registered the company. The Owner sees the whole company on the dashboard, can add **HR Managers** as well as Recruiters, Trainers and Employees, and can do everything an HR Manager can. HR Managers run hiring and the team below them. Recruiters see their own jobs and applicants.',
    hi: '**Owner** wo hai jisne company register ki. Owner dashboard par poori company dekhta hai, **HR Manager** ke saath Recruiter, Trainer aur Employee bhi jod sakta hai, aur HR Manager ke saare kaam kar sakta hai. HR Manager hiring aur apne neeche ki team chalata hai. Recruiter apni jobs aur applicants dekhta hai.',
    actions: ['/team', '/dashboard'],
  },
  {
    id: 'team_password',
    keywords: ['reset password', 'team password', 'forgot password', 'password bhool', 'password reset', 'change password', 'password badal', 'recruiter password', 'member password'],
    en: 'To reset a team member\'s password: the **HR Manager** opens **Team & Roles**, picks the member and sets a new password (8+ characters with uppercase, lowercase and a number), then shares it with them.\n\nIf the HR Manager\'s own password is lost, the Super Admin can set a new one for your company. Raise a ticket and we will help.',
    hi: 'Team member ka password reset karne ke liye: **HR Manager** **Team & Roles** kholkar member chunta hai aur naya password set karta hai (8+ characters, capital, small letter aur number ke saath), phir use member ko bata deta hai.\n\nHR Manager ka apna password kho jaye to Super Admin aapki company ke liye naya password set kar sakta hai. Ticket raise karein, hum madad karenge.',
    actions: ['/team', '/support?new=1'],
  },
  {
    id: 'post_job',
    keywords: ['post a job', 'post job', 'create job', 'add job', 'new job', 'publish job', 'job post', 'job daal', 'job daalna', 'job create', 'vacancy', 'opening post', 'naukri post', 'job kaise', 'hire someone', 'job publish'],
    en: 'To post a job:\n1. Open **Job Postings → Post a job**.\n2. Fill the title, department and location, then work mode, type, openings, experience and salary.\n3. Write the description (at least 30 characters) and pick the **last date to apply**.\n4. Click **Save draft** to keep it private, or **Publish job** to make it live for candidates.\n\nA draft is never shown to candidates. A live job closes automatically after its last date.',
    hi: 'Job post karne ke liye:\n1. **Job Postings → Post a job** kholein.\n2. Title, department aur location bharein, phir work mode, type, openings, experience aur salary.\n3. Description likhein (kam se kam 30 characters) aur **last date to apply** chunein.\n4. **Save draft** dabayein to job private rahegi, ya **Publish job** dabayein to candidates ko dikhegi.\n\nDraft candidates ko kabhi nahi dikhta. Live job last date ke baad apne aap band ho jati hai.',
    actions: ['/jobs/new', '/jobs'],
  },
  {
    id: 'job_status',
    keywords: ['job status', 'job expired', 'expired job', 'job live', 'draft job', 'job not showing', 'job not visible', 'job dikh nahi', 'job nahi dikh', 'reopen job', 'close job', 'job close', 'archive job', 'edit job', 'job edit', 'job band', 'job reopen', 'job statuses'],
    en: 'Job statuses:\n- **Draft**: private, only you see it.\n- **Live**: visible to candidates until the last date.\n- **Expired**: the last date has passed; it disappears from the public list.\n- **Closed**: you closed it. You can **Reopen** it.\n- **Archived**: tucked away; **Restore** brings it back as a draft.\n\nTo reopen an expired job, edit it and set a new future last date first. Use **Edit** on a job card to change any detail.',
    hi: 'Job ke status:\n- **Draft**: private, sirf aap dekhte hain.\n- **Live**: last date tak candidates ko dikhti hai.\n- **Expired**: last date nikal gayi; public list se hat jati hai.\n- **Closed**: aapne band ki hai. **Reopen** kar sakte hain.\n- **Archived**: side me rakhi hai; **Restore** karne par wapas draft ban jati hai.\n\nExpired job dobara kholne ke liye pehle Edit karke nayi future last date daalein. Koi bhi detail badalne ke liye job card par **Edit** dabayein.',
    actions: ['/jobs'],
  },
  {
    id: 'jd_file',
    keywords: ['jd', 'job description file', 'attach file', 'upload jd', 'attach jd', 'jd upload', 'pdf job', 'jd file'],
    en: 'You can attach a JD file (PDF, DOC or DOCX, up to 5 MB) to a job. **Save the job as a draft first**, then on the job\'s edit page use **Upload JD**. You can replace or remove it any time.',
    hi: 'Job ke saath JD file (PDF, DOC ya DOCX, 5 MB tak) laga sakte hain. **Pehle job ko draft me save karein**, phir job ke edit page par **Upload JD** dabayein. File kabhi bhi badal ya hata sakte hain.',
    actions: ['/jobs'],
  },
  {
    id: 'find_candidates',
    keywords: ['find candidate', 'search candidate', 'shortlist', 'shortlisting', 'candidate search', 'find candidates', 'talent pool', 'search talent', 'candidate dhund', 'candidate kaise', 'dhundh', 'dhoondh', 'dhund', 'candidates kaise', 'resume', 'cv', 'filter candidate', 'candidates nahi', 'no candidates', '0 candidates'],
    en: 'Open **Find Candidates** and use the filters: skills, experience, location and education. Open a candidate to see the profile. Click **Shortlist** to unlock their contact details and resume.\n\nIf you see "0 candidates", it means no candidate has created a public profile yet. Candidates appear as they sign up and are approved on the Candidate portal.',
    hi: '**Find Candidates** kholein aur filters lagayein: skills, experience, location aur education. Candidate par click karke profile dekhein. **Shortlist** dabane par unka contact aur resume dikhne lagta hai.\n\nAgar "0 candidates" dikhe, to matlab abhi kisi candidate ne public profile nahi banayi hai. Candidates Candidate portal par sign up aur approve hone ke baad yahan dikhte hain.',
    actions: ['/candidates'],
  },
  {
    id: 'team',
    keywords: ['add team', 'team member', 'add recruiter', 'new recruiter', 'create recruiter', 'add trainer', 'add employee', 'team and roles', 'team & roles', 'roles', 'recruiter banana', 'recruiter add', 'team add', 'user add', 'add user', 'recruiter', 'trainer', 'team jod', 'member jod', 'member add', 'login banana', 'login bana'],
    en: 'Only the **HR Manager** can manage the team. Open **Team & Roles → Add member**, choose a role (Recruiter, Trainer or Employee), enter name, email and a password (8+ characters with uppercase, lowercase and a number). Share the email and password with the member; they sign in from the **Client / HR** tab.\n\nYou can also edit a member, disable access or reset their password from the same page.',
    hi: 'Team sirf **HR Manager** manage kar sakta hai. **Team & Roles → Add member** kholein, role chunein (Recruiter, Trainer ya Employee), naam, email aur password daalein (8+ characters, capital, small letter aur number). Email aur password member ko de dein; wo **Client / HR** tab se sign in karega.\n\nSame page se member ko edit, disable ya uska password reset bhi kar sakte hain.',
    actions: ['/team'],
  },
  {
    id: 'profile',
    keywords: ['edit profile', 'profile edit', 'change name', 'change phone', 'profile photo', 'upload photo', 'my profile', 'edit access', 'request edit', 'profile badal', 'photo lagana', 'photo upload', 'designation change', 'update profile'],
    en: 'Your **photo** can be changed any time from My Profile.\n\nTo change **name, phone, designation or department** you need approval: click **Request edit access** and give a reason. When the Super Admin approves, you can edit once within 24 hours. Your email and role cannot be changed there.',
    hi: 'Aapki **photo** My Profile se kabhi bhi badal sakte hain.\n\n**Naam, phone, designation ya department** badalne ke liye approval chahiye: **Request edit access** dabayein aur wajah likhein. Super Admin approve kare to aap 24 ghante ke andar ek baar edit kar sakte hain. Email aur role wahan se nahi badalte.',
    actions: ['/profile'],
  },
  {
    id: 'registration',
    keywords: ['registration status', 'approval', 'approved', 'not approved', 'pending', 'verification', 'when will i be approved', 'approve nahi', 'approval kab', 'register ke baad', 'documents requested', 'more documents', 'rejected', 'registration pending'],
    en: 'After you register, the Super Admin verifies your company and documents. You can sign in only **after approval**.\n- **Pending**: under review.\n- **More documents requested**: upload what was asked by raising a ticket or contacting support.\n- **Rejected**: the reason was recorded; raise a ticket to discuss.\n\nIf it has been a while, raise a ticket and mention your company name.',
    hi: 'Register karne ke baad Super Admin aapki company aur documents verify karta hai. Sign in **approval ke baad hi** hota hai.\n- **Pending**: review chal raha hai.\n- **More documents requested**: jo maanga gaya hai wo ticket ya support ke zariye bhejein.\n- **Rejected**: wajah record hai; baat karne ke liye ticket raise karein.\n\nKaafi time ho gaya ho to ticket raise karein aur company ka naam likhein.',
    actions: ['/support?new=1'],
    escalate: true,
  },
  {
    id: 'documents',
    keywords: ['documents', 'document required', 'which documents', 'pan card', 'gst certificate', 'registration certificate', 'address proof', 'kaun se documents', 'document upload', 'documents kya'],
    en: 'Mandatory documents for company verification: Company Registration Certificate, PAN Card (company or firm), GST Certificate, Authorized Signatory ID Proof and Business Address Proof. Files can be PDF, JPG or PNG up to 5 MB each. CIN, MSME, Startup India, ISO and Shop & Establishment certificates are optional.',
    hi: 'Company verification ke zaroori documents: Company Registration Certificate, PAN Card (company ya firm), GST Certificate, Authorized Signatory ID Proof aur Business Address Proof. Files PDF, JPG ya PNG ho sakti hain, har ek 5 MB tak. CIN, MSME, Startup India, ISO aur Shop & Establishment certificate optional hain.',
    actions: ['/support?new=1'],
  },
  {
    id: 'after_shortlist',
    keywords: ['after shortlist', 'what happens next', 'interview', 'how do candidates apply', 'candidate apply', 'candidate process', 'hire candidate', 'selection', 'candidate ko kaise', 'shortlist ke baad'],
    en: 'Candidates sign up on the Candidate portal with a resume, get approved, take the entrance test and interview, sign the bond and join a training batch. As a company you can search the verified talent pool, shortlist people and post jobs. More hiring steps (applicants pipeline) are being added.',
    hi: 'Candidates Candidate portal par resume ke saath sign up karte hain, approve hote hain, entrance test aur interview dete hain, bond sign karte hain aur training batch join karte hain. Company ke roop me aap verified talent pool search kar sakte hain, logon ko shortlist kar sakte hain aur jobs post kar sakte hain. Aage ke hiring steps (applicants pipeline) jald jud rahe hain.',
    actions: ['/candidates', '/jobs'],
  },
  {
    id: 'privacy',
    keywords: ['privacy', 'data safe', 'who can see', 'secure', 'security', 'data protection', 'gdpr', 'data kaun', 'safe hai'],
    en: 'Your data is private to your company. A candidate\'s contact details and resume are visible only after you shortlist them. Each company sees only its own jobs and team. Important actions are written to an audit log, passwords are stored encrypted, and uploaded files are served only to signed-in users with permission.',
    hi: 'Aapka data sirf aapki company ke liye private hai. Candidate ka contact aur resume shortlist karne ke baad hi dikhta hai. Har company sirf apni jobs aur team dekhti hai. Zaroori actions audit log me likhe jate hain, passwords encrypted rakhe jate hain, aur uploaded files sirf permission wale sign-in users ko milti hain.',
    actions: [],
  },
  {
    id: 'billing',
    keywords: ['price', 'pricing', 'invoice', 'billing', 'payment', 'subscription', 'plan', 'charges', 'fees', 'cost', 'kitna paisa', 'paise', 'bill', 'refund'],
    en: 'Invoices, plans and payments for companies are not inside the portal yet. For commercial questions please raise a ticket under the **Billing** category and our team will reply.',
    hi: 'Company ke invoices, plans aur payments abhi portal ke andar nahi hain. Paise ya plan se jude sawaal ke liye **Billing** category me ticket raise karein, hamari team jawab degi.',
    actions: ['/support?new=1'],
    escalate: true,
  },
  {
    id: 'coming_soon',
    keywords: ['employee directory', 'probation', 'training module', 'replacement', 'asset id', 'onboarding', 'attendance', 'payroll', 'leave', 'performance review', 'coming soon', 'roadmap'],
    en: 'Employee directory with Asset ID, probation tracking, training, agreements and replacement management are planned and will appear in your workspace soon. Tell us what you need most by raising a ticket, it helps us decide the order.',
    hi: 'Asset ID wali employee directory, probation tracking, training, agreements aur replacement management planned hain aur jaldi aapke workspace me aayenge. Sabse zyada kya chahiye, ye ticket me bata dein, isse humein order tay karne me madad milti hai.',
    actions: ['/support?new=1'],
  },
  {
    id: 'human',
    keywords: ['human', 'talk to someone', 'talk to support', 'support', 'contact', 'agent', 'ticket', 'complaint', 'issue not solved', 'problem not solved', 'escalate', 'insaan', 'kisi se baat', 'shikayat', 'raise ticket'],
    en: 'Sure. I can open a support ticket for you. Describe the problem in a few lines, choose a category, and the Super Admin team will reply inside the ticket. You will see their answer under **Help & Support**.',
    hi: 'Zaroor. Main aapke liye support ticket khol sakta hoon. Problem kuch lines me likhein, category chunein, aur Super Admin team ticket ke andar jawab degi. Jawab aapko **Help & Support** me dikhega.',
    actions: ['/support?new=1', '/support'],
  },
];

const HINGLISH = ['kaise', 'kese', 'nahi', 'nhi', 'kya', 'hai', 'hain', 'karo', 'karna', 'kar', 'mujhe', 'mera', 'meri', 'chahiye', 'bhai', 'wala', 'wali', 'kab', 'kaun', 'kyun', 'kyu', 'raha', 'rahi', 'dikha', 'banana', 'daal', 'daalna', 'karein', 'batao', 'bataye', 'madad'];

const STOP = new Set(['a', 'an', 'the', 'my', 'our', 'your', 'to']);
// lower-case, remove punctuation and filler words (a, an, the...) so "add a recruiter" matches "add recruiter"
export const normalize = (t) => {
  const words = String(t).toLowerCase().replace(/[^a-z0-9\u0900-\u097f&'+? ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  return ` ${words.join(' ')} `;
};

export function detectLang(text) {
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  const n = normalize(text);
  return HINGLISH.filter((w) => n.includes(` ${w} `)).length >= 1 ? 'hi' : 'en';
}

export function matchTopic(text) {
  const n = normalize(text);
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      const k = normalize(kw).trim();
      const hit = k.length <= 3 ? n.includes(` ${k} `) : n.includes(k);
      if (hit) score += k.includes(' ') ? 3 : 2; // phrases count more than single words
    }
    if (score > bestScore) { best = topic; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

export const factsForAI = () =>
  TOPICS.filter((t) => !['greeting', 'thanks'].includes(t.id)).map((t) => `## ${t.id}\n${t.en}`).join('\n\n');

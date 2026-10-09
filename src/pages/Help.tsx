import { useState } from "react";
import {
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  Copy,
  FileText,
  KeyRound,
  LockKeyhole,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  Stamp,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CurrentUser } from "@/lib/types";

const ADMIN_EMAIL = "kuunda@longhorn-associates.com";

type Topic = {
  icon: typeof FileText;
  question: string;
  answer: string;
};

/** Role-specific first, then the things everyone asks. */
const topics = (user: CurrentUser | null): Topic[] => {
  const shared: Topic[] = [
    {
      icon: FileText,
      question: "Why can't I see a voucher I know exists?",
      answer:
        "Your workspace holds only the vouchers you prepared yourself, so a colleague's payments will not appear. That is enforced by the database, not just hidden in the screen. If a payment you raised is missing, check which branch it was raised under, or ask an approver, who sees all three.",
    },
    {
      icon: Stamp,
      question: "Can I approve a whole month at once?",
      answer:
        "Yes. Approvers get 'Approve a month' in the sidebar. Choose the month, tick what you want, and approve the lot in one action. Only closed months can be cleared in bulk, because the current month is still collecting vouchers.",
    },
    {
      icon: Building2,
      question: "I work for the wrong branch",
      answer:
        "Branch assignment is set by a workspace admin and cannot be changed from Settings. Get in touch and it will be corrected for you.",
    },
    {
      icon: CalendarClock,
      question: "A voucher is missing from my month",
      answer:
        "Check the voucher date, not the date it was entered. Monthly views group by the payment date on the voucher itself.",
    },
    {
      icon: LockKeyhole,
      question: "My password isn't working",
      answer:
        "Passwords are case sensitive. If you are still stuck, a workspace admin can reset it for you from the admin panel.",
    },
    {
      icon: ShieldCheck,
      question: "Who can see what?",
      answer:
        "Each preparer creates vouchers in their own branch and sees only the ones they prepared, so nobody's list is mixed with a colleague's. Approvers see every branch and approve payments but do not create them. Admins do everything and manage people, roles and branches.",
    },
  ];

  if (user?.canPrepare) {
    shared.unshift({
      icon: Check,
      question: "Why can't I save a voucher?",
      answer:
        "Every voucher needs an amount, a date, a payee, a payment purpose and an approver. The approver list only shows people with the approver role, so if it looks empty, ask an admin to promote someone in your branch.",
    });
  }

  if (user?.isApprover) {
    shared.unshift({
      icon: Check,
      question: "How do I change my approver on an existing voucher?",
      answer:
        "Ask a preparer to raise it again, or have an admin adjust it. Approvals are a record of what was signed, so they are not edited after the fact.",
    });
  }

  return shared;
};

const HelpCentre = ({ user, onBack }: { user: CurrentUser | null; onBack: () => void }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(ADMIN_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error("Could not copy. Select the address and copy it manually.");
    }
  };

  const sendMessage = () => {
    const text = message.trim();
    if (!text) {
      toast.error("Write what you need help with first.");
      return;
    }
    // Opens the user's mail client with the details pre-filled. Nothing is sent
    // from the browser, so nothing is stored anywhere.
    const subject = encodeURIComponent(`Ledger help request from ${user?.fullName || "a user"}`);
    const body = encodeURIComponent(`${text}\n\n---\nSent from the Longhorn Ledger help centre.\nAccount: ${user?.email || "unknown"}`);
    window.location.href = `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
    setMessage("");
  };

  const list = topics(user);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> HELP CENTRE
          </div>
          <h1>How can we help?</h1>
          <p>Answers to the questions we get most, and a direct line to your system administrator.</p>
        </div>
        <Button onClick={onBack} className="secondary-action">Back to the ledger</Button>
      </div>

      {/* ------------------------------------------------------- contact card */}
      <section className="panel help-contact">
        <div className="help-contact-main">
          <div className="help-contact-mark"><MessageSquare size={22} /></div>
          <div className="min-w-0">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR SYSTEM ADMINISTRATOR</div>
            <h2>Still stuck? Talk to Kuunda.</h2>
            <p>
              Anything about roles, branches, access, or a voucher that looks wrong, Kuunda can sort it out.
            </p>
            <div className="help-email-row">
              <a href={`mailto:${ADMIN_EMAIL}`} className="help-email">
                <Mail size={16} />
                <span>{ADMIN_EMAIL}</span>
              </a>
              <button onClick={copyEmail} className="help-copy" aria-label="Copy the email address">
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
        <div className="help-contact-note">
          <ShieldCheck size={16} />
          <span>
            <b>Someone else needs help?</b>
            <small>Ask Kuunda to add them, or to grant the role they need.</small>
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------------- topics */}
      <section className="panel help-topics">
        <div className="panel-heading">
          <div>
            <h2>Common questions</h2>
            <p>Tap one to open it</p>
          </div>
          <BookOpen size={17} className="text-[#9ca5b5]" />
        </div>
        <div className="help-topic-list">
          {list.map((topic) => {
            const Icon = topic.icon;
            const isOpen = open === topic.question;
            return (
              <div key={topic.question} className={`help-topic ${isOpen ? "help-topic-open" : ""}`}>
                <button className="help-topic-q" onClick={() => setOpen(isOpen ? null : topic.question)} aria-expanded={isOpen}>
                  <span className="help-topic-icon"><Icon size={16} /></span>
                  <span className="help-topic-text">{topic.question}</span>
                  <span className="help-topic-mark">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && <p className="help-topic-a">{topic.answer}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------- quick links */}
      <section className="help-links">
        <div className="help-link-card" onClick={onBack}>
          <span className="help-link-icon red"><FileText size={17} /></span>
          <div>
            <b>Create a voucher</b>
            <small>Capture a payment and nominate an approver</small>
          </div>
        </div>
        {user?.isApprover && (
          <div className="help-link-card" onClick={onBack}>
            <span className="help-link-icon green"><Stamp size={17} /></span>
            <div>
              <b>Approve a month</b>
              <small>Clear a whole month in one action</small>
            </div>
          </div>
        )}
        {user?.isAdmin && (
          <div className="help-link-card">
            <span className="help-link-icon navy"><UserCog size={17} /></span>
            <div>
              <b>Admin panel</b>
              <small>Manage branches, roles and access</small>
            </div>
          </div>
        )}
        <div className="help-link-card">
          <span className="help-link-icon gold"><Users size={17} /></span>
          <div>
            <b>Adding someone</b>
            <small>An admin creates the account and sets the role</small>
          </div>
        </div>
        <div className="help-link-card">
          <span className="help-link-icon navy"><KeyRound size={17} /></span>
          <div>
            <b>Forgotten password</b>
            <small>Reset it yourself in Settings</small>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- message form */}
      <section className="panel help-message">
        <div className="panel-heading">
          <div>
            <h2>Send a message</h2>
            <p>Opens your email app with the details filled in. Nothing is stored here.</p>
          </div>
          <Send size={17} className="text-[#9ca5b5]" />
        </div>
        <div className="help-message-body">
          <label className="field">
            <span>What do you need?</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="e.g. I cannot see the August vouchers for Longhorn Insurance Broking."
            />
          </label>
          <div className="help-message-actions">
            <small>Goes to {ADMIN_EMAIL}</small>
            <Button onClick={sendMessage} className="primary-action" disabled={!message.trim()}>
              <Send size={15} /> Open in my email app
            </Button>
          </div>
        </div>
      </section>
    </>
  );
};

export { ADMIN_EMAIL as HELP_CONTACT_EMAIL };
export default HelpCentre;
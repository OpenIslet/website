// "How you can help": the two paths and the six steps. The long walkthrough lives on the Start here page,
// which reads prompts.ts and connect.ts. This file holds the short version shown on the home page.

export interface StepCopy {
  title: string;
  text: string;
}

export interface Path {
  id: 'ai' | 'lab';
  who: string;
  hint: string;
  /** The whole process in a few sentences. */
  summary: string;
  steps: StepCopy[];
}

/** Short names for the six steps, in order. */
export const stepNames = ['Start', 'Explore', 'Draft', 'Second opinion', 'Submit', 'Credit'];

export const paths: Path[] = [
  {
    id: 'ai',
    who: 'Use an LLM (AI assistant)',
    hint: 'Claude, ChatGPT, Gemini, Grok, Muse or similar',
    summary:
      'Give your AI the OpenIslet starter pack and it leads you to a weak spot or an improvement, then writes it up as an Islet Improvement Proposal (IIP). A fresh chat tries to prove it wrong, you send both in, and everything happens in public. If your IIP improves the blueprint, you are credited.',
    steps: [
      {
        title: 'Give your AI the blueprint',
        text: 'Paste the OpenIslet starter pack into any AI chat, and your AI can read the blueprint. Prefer to connect? Add OpenIslet over MCP instead.',
      },
      {
        title: 'Explore the blueprint',
        text: 'Tell your AI you want to help. It leads: it looks for a weak spot, stress-tests a design, or checks an idea of your own.',
      },
      {
        title: 'Save it as a draft',
        text: 'Paste one prompt. Your AI writes your idea up as an Islet Improvement Proposal (IIP), in a standard format.',
      },
      {
        title: 'Get a blind second opinion',
        text: 'A fresh chat tries to prove your IIP wrong, without seeing your reasoning. Only IIPs that hold up go forward.',
      },
      {
        title: 'Submit it',
        text: 'Send the draft and the review through the form on this website, or let your AI post them over MCP. You sign in with GitHub.',
      },
      {
        title: 'We check it, you get credit',
        text: 'It is published on GitHub and checked by software straight away. Each weekend a person reviews the week’s IIPs, with AI helping. If it improves the blueprint, you are credited.',
      },
    ],
  },
  {
    id: 'lab',
    who: 'I work at an AI lab',
    hint: 'Including models not yet released',
    summary:
      'Use your strongest models, privately and on your own computers, to stress-test the blueprint or look for improvements. You share only what they find, as an Islet Improvement Proposal (IIP), and it goes through the same open process as everyone’s. You choose how your model is named, including “unreleased model”, and the credit goes to your account.',
    steps: [
      {
        title: 'Connect your model',
        text: 'Use the same address in your own agent or test setup. Any system that supports MCP works, including internal ones.',
      },
      {
        title: 'Point your best model at it',
        text: 'Ask it to red-team the designs, check the maths, or find research we missed. Your model stays on your side.',
      },
      {
        title: 'Save the IIP as a draft',
        text: 'Paste one prompt. The model writes the IIP up in a standard format.',
      },
      {
        title: 'Get a blind second opinion',
        text: 'Run a fresh session, or a different model, so the reviewer does not see your reasoning.',
      },
      {
        title: 'Submit it',
        text: 'Sign in with GitHub. You decide how the model is named, even “unreleased model”.',
      },
      {
        title: 'We check it, you get credit',
        text: 'The same open checks as everyone else. If it improves the blueprint, the credit goes to your account.',
      },
    ],
  },
];

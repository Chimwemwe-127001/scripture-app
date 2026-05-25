// Demo mode data: a short simulated sermon and the suggestions the pipeline
// would produce for it. Verse text is KJV (public domain), matching the app.
// Each suggestion fires once its `cue` phrase has appeared in the transcript.

export const SERMON_EXCERPT = (
  "Good morning, church. Today we're going to look at one of the most " +
  "beloved passages in all of scripture. John chapter three, verse sixteen " +
  "tells us that God so loved the world, that he gave his only begotten Son. " +
  "That is the gospel in one sentence. And you know, David wrote that the Lord " +
  "is his shepherd, and he shall not want. He leads him beside the still waters " +
  "and restores his soul. Brothers and sisters, God is not finished with us. " +
  "Romans chapter eight, verse twenty-eight says that all things work together " +
  "for good to them that love God. Hallelujah! And his peace, the peace that " +
  "passes all understanding, will keep your hearts and minds. " +
  "I want to remind you of Isaiah forty, verse thirty-one: they that wait upon " +
  "the Lord shall renew their strength. They shall mount up with wings as eagles. " +
  "Jesus is the way, and the truth, and the life. So trust him with all your " +
  "heart, and do not lean on your own understanding, because he has good " +
  "thoughts toward you and a future for you. May God bless you as you go in his name."
).split(' ')

export const MOCK_SCRIPTURES = [
  {
    id: 1,
    reference: "John 3:16",
    cue: "John chapter three, verse sixteen",
    text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    confidence: "high",
    trigger: "explicit",
    translation: "KJV"
  },
  {
    id: 2,
    reference: "Psalms 23:1-3",
    cue: "the Lord is his shepherd",
    text: "The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
    confidence: "medium",
    trigger: "paraphrase",
    translation: "KJV"
  },
  {
    id: 3,
    reference: "Romans 8:28",
    cue: "Romans chapter eight, verse twenty-eight",
    text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
    confidence: "high",
    trigger: "explicit",
    translation: "KJV"
  },
  {
    id: 4,
    reference: "Philippians 4:7",
    cue: "passes all understanding",
    text: "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
    confidence: "medium",
    trigger: "paraphrase",
    translation: "KJV"
  },
  {
    id: 5,
    reference: "Isaiah 40:31",
    cue: "Isaiah forty, verse thirty-one",
    text: "But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.",
    confidence: "high",
    trigger: "explicit",
    translation: "KJV"
  },
  {
    id: 6,
    reference: "John 14:6",
    cue: "the way, and the truth, and the life",
    text: "Jesus saith unto him, I am the way, the truth, and the life: no man cometh unto the Father, but by me.",
    confidence: "medium",
    trigger: "paraphrase",
    translation: "KJV"
  },
  {
    id: 7,
    reference: "Proverbs 3:5-6",
    cue: "trust him with all your heart",
    text: "Trust in the Lord with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.",
    confidence: "medium",
    trigger: "paraphrase",
    translation: "KJV"
  },
  {
    id: 8,
    reference: "Jeremiah 29:11",
    cue: "thoughts toward you",
    text: "For I know the thoughts that I think toward you, saith the Lord, thoughts of peace, and not of evil, to give you an expected end.",
    confidence: "low",
    trigger: "allusion",
    translation: "KJV"
  }
]

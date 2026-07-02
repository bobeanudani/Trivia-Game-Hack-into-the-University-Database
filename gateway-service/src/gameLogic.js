const questionPool = {
  1: {
    question: {
      title: "FIREWALL CHALLENGE",
      text: "What reptile does THE DEAN hate the most?"
    },
    answer: "python"
  },

  2: {
    question: {
      title: "ENCRYPTION LAYER",
      text: "What brand does Prof. Ciuca has on his mug?"
    },
    answer: "docker"
  },

  3: {
    question: {
      title: "SYSTEM CORE",
      text: "Which professor shares her name with what students do after Prof. Serban's exam? "
    },
    answer: "bautu"
  },

  4: {
    question: {
      title: "ROOT ACCESS",
      text: "Which professor could be cited as a source in a forestry thesis? "
    },
    answer: "crenguta"
  },

  5: {
    question: {
      title: "ACESS DENIED",
      text: "Which office is always open, except when you actually need it? "
    },
    answer: "secretariat"
  },

  6: {
    question: {
      title: "SOCIAL ENGINEERING",
      text: "Complete this famous line: 'Baietii de la mate info sunt cele mai de treaba ___' "
    },
    answer: "fete"
  },

  7: {
    question: {
      title: "HIDDEN PAYLOAD",
      text: "Which professor shares their name with the bird that looks serious but is secretly carrying a lot?"
    },
    answer: "pelican"
  },

  8: {
    question: {
      title: "KERNEL PANIC",
      text: "What do you get when you mix sleep deprivation, linear algebra and a hint of regret?"
    },
    answer: "fmi"
  },

  9: {
    question: {
      title: "UNREACHABLE HOST",
      text: "What's the promised land that FMI students have heard of, but never quite reached?"
    },
    answer: "campus"
  },
  
  10: {
    question: {
      title: "STACK OVERFLOW",
      text: "What's the Romanian word for 'everything is due tomorrow and it's already tomorrow' ?"
    },
    answer: "sesiune"
  },
  
  11: {
    question: {
      title: "HOME DIRECTORY",
      text: "What's the place where 4 people share 10 square meters and somehow all have different sleep schedules? ?"
    },
    answer: "camin"
  }, 

  12: {
    question: {
      title: "LOW LEVEL THREAT",
      text: "What's the programming language that turns a 3 line problem into a 300 line existential crisis?"
    },
    answer: "assembly"
  }, 

  13: {
    question: {
      title: "MIDDLE MAN",
      text: "What tool do students use to write their homework, and professors use to check if students used it to write their homework?"
    },
    answer: "chatgpt"
  }, 

  14: {
    question: {
      title: "BUFFER OVERFLOW",
      text: "What word makes a CS student open their laptop at 11:58 PM for a task assigned 3 weeks ago?"
    },
    answer: "deadline"
  }, 

};

const finalSQLQuestion = {
  question: {
    title: "DATABASE OVERRIDE",
    text: (user) => `To run the SQL and update your grade to 10 type 'ilovesabd': \n\n UPDATE grades SET grade = 10 \n WHERE student_id = (SELECT id FROM students WHERE name = '${user}') \n AND course_id = (SELECT id FROM courses WHERE name = 'Sisteme avansate de baze de date');`
  },
  answer: "ilovesabd"
};

// Generates a 7-step playlist unique to a user
function generatePlaylist() {
  const keys = Object.keys(questionPool);
  
  // Shuffleusing Fisher-Yates algorithm
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  // Grab the first 6 random questions from your pool
  const selectedPoolKeys = keys.slice(0, 6);

  // Map them into an array of question objects
  const playlist = selectedPoolKeys.map(key => questionPool[key]);

  // ALWAYS append the final SQL question as the 7th item (index 6)
  playlist.push(finalSQLQuestion);

  return playlist;
}

function checkAnswerInPlaylist(playlist, level, submittedAnswer) {
  const currentQuestionIndex = level - 1;
  const questionData = playlist[currentQuestionIndex];
  if (!questionData) return false;

  return questionData.answer.toLowerCase() === submittedAnswer.trim().toLowerCase();
}

module.exports = { generatePlaylist, checkAnswerInPlaylist };
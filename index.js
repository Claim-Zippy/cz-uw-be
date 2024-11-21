/*

Pre-existing diseases (PEDs) are health conditions that an individual has prior to obtaining health insurance, and insurance companies often consider them high-risk. The primary PEDs that raise concerns for insurers include:

Diabetes – Often associated with complications like heart disease, kidney issues, and neuropathy.
Hypertension – Increases the risk of cardiovascular diseases, stroke, and kidney disease.
Cardiovascular diseases – Conditions like coronary artery disease, heart attack, and stroke are costly to manage and have a high recurrence risk.
Cancer – Certain cancers require long-term treatment and have significant financial impact.
Asthma and COPD – Chronic respiratory diseases often require regular treatment and can lead to costly complications.
Obesity – Leads to various complications, including diabetes, cardiovascular disease, and joint issues.
Kidney disease – Chronic kidney disease and related conditions can lead to high treatment costs, especially in cases requiring dialysis.
Mental health conditions – Depression, anxiety, and other mental health conditions can result in recurrent treatment costs and medication needs.
Insurance companies typically implement waiting periods, higher premiums, or exclusions for such PEDs to mitigate the financial risk associated with these conditions.


Todo list:
1. Get questionText also into the recorded answers
2. Generate JSON's for all the above 8 types of concerning PEDs
3. Test them 1 by 1
4. Create a page with checkbox to select if the patient has any of these PEDs before jumping into assessments
5. If multiple items are ticked, put them in queue and do deep dive assessments for each

*/


const express = require('express');
const session = require('express-session');
// const morgan = require('morgan');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const app = express();
const PORT = 5001;

// app.use(morgan);

// MongoDB connection string
const mongoURI = 'mongodb://localhost:27017/underwriting';  // Change this to your actual connection string

// Connect to MongoDB
mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch((err) => console.log('MongoDB connection error: ', err));

// Use JSON parser middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'Tesla',  // Change this to a secure secret key
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 1 * 60 * 60 * 1000 // 1 hour
    }
}));

// Mongoose Schema for the cdf_master collection (Question bank)
const cdfMasterSchema = new mongoose.Schema({
    assessmentType: String,
    assessmentId: String,
    questions: [
        {
            questionId: String,
            questionText: String,
            answerType: String,
            choices: [
                {
                    choiceText: String,
                    nextQuestionId: String
                }
            ]
        }
    ],
    outcomes: [
        {
            outcomeId: String,
            description: String,
            criteria: [
                {
                    questionId: String,
                    expectedAnswer: String
                }
            ],
            icd10_code: String
        }
    ]
});

const userSchema = new mongoose.Schema({
    username: {
      type: String,
      required: true,
      unique: true
    },
    email: {
      type: String,
      required: true,
      unique: true
    },
    // Add other user fields as needed
  }, { timestamps: true });
  
  const User = mongoose.model('User', userSchema);

const CdfMaster = mongoose.model('CdfMaster', cdfMasterSchema);

// Mongoose Schema for the cdf_respondents collection (User responses)
const cdfRespondentsSchema = new mongoose.Schema({
    proposerId: String,
    assessmentType: String,
    assessmentId: String,
    selectedDisease: [String],
    responses: [
        {
            questionId: String,
            questionText: String,
            answer: String,
            timestamp: { type: Date, default: Date.now }
        }
    ]
});

const CdfRespondents = mongoose.model('CdfRespondents', cdfRespondentsSchema);

const CDFMasterSchema = new mongoose.Schema({
    name: String,
    description: String,
    inactive: Boolean,
});

const CDFMaster = mongoose.model('CDFMaster', CDFMasterSchema);

app.get('/api/0.0/diseases', async (req, res) => {
    try {
        const diseases = await CdfMaster.distinct('assessmentType');
        res.json({ diseases });
    } catch (error) {
        console.error('Error fetching diseases:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// API to fetch a question from the cdf_master collection (read-only)
app.get('/api/0.0/assessments/:assessmentType/first-question', async (req, res) => {
    const { assessmentType } = req.params;

    try {
        const assessment = await CdfMaster.findOne(
            { assessmentType },
            {
                "questions.questionId": 1,
                "questions.questionText": 1,
                "questions.answerType": 1,
                "questions.choices.choiceText": 1
            }
        );

        if (!assessment) {
            return res.status(404).json({ error: "Assessment not found" });
        }

        const firstQuestion = assessment.questions[0];

        if (!firstQuestion) {
            return res.status(404).json({ error: "No questions found in assessment" });
        }

        // Initialize session data
        req.session.assessmentData = {
            currentQuestionId: firstQuestion.questionId,
            assessmentType: assessmentType,
            userResponses: []
        };

        // Send response
        const formattedQuestion = {
            questionText: firstQuestion.questionText,
            answerType: firstQuestion.answerType,
            choices: firstQuestion.choices.map(choice => ({
                choiceText: choice.choiceText
            }))
        };

        res.json({ question: formattedQuestion });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

// 2. API endpoint for getting next question
app.post('/api/0.0/assessments/next-question', async (req, res) => {
    const { selectedChoice, proposerId } = req.body;
    
    try {
        // Validate proposerId
        if (!proposerId) {
            return res.status(400).json({ 
                error: "Proposer ID is required" 
            });
        }

        // Check if session exists
        if (!req.session.assessmentData) {
            return res.status(400).json({ 
                error: "Assessment session not found. Please start a new assessment." 
            });
        }

        const { 
            currentQuestionId, 
            assessmentType,
            assessmentId
        } = req.session.assessmentData;

        // Find the assessment in CdfMaster
        const assessment = await CdfMaster.findOne({ assessmentType });

        if (!assessment) {
            return res.status(404).json({ error: "Assessment not found" });
        }

        // Find current question
        const currentQuestion = assessment.questions.find(
            q => q.questionId === currentQuestionId
        );
        
        if (!currentQuestion) {
            return res.status(404).json({ error: "Current question not found" });
        }

        // Validate selected choice
        const selectedChoiceObj = currentQuestion.choices.find(
            c => c.choiceText === selectedChoice
        );
        
        if (!selectedChoiceObj) {
            return res.status(400).json({ error: "Invalid choice selected" });
        }

        // Prepare current response
        const currentResponse = {
            questionId: currentQuestionId,
            questionText: currentQuestion.questionText,
            answer: selectedChoice,
            timestamp: new Date()
        };

        // Find or create CdfRespondents document
        let respondentsDoc = await CdfRespondents.findOne({ 
            proposerId: proposerId, 
            assessmentType: assessmentType,
            assessmentId: assessmentId
        });

        // If no existing document, create a new one
        if (!respondentsDoc) {
            respondentsDoc = new CdfRespondents({
                proposerId: proposerId,
                assessmentType: assessmentType,
                assessmentId: assessmentId,
                selectedDisease: [],
                responses: []
            });
        }

        // Add current response to responses
        respondentsDoc.responses.push(currentResponse);

        // Check if assessment is complete
        if (!selectedChoiceObj.nextQuestionId) {
            // Determine final outcome
            const outcome = assessment.outcomes.find(o => 
                o.criteria.every(c => {
                    const userResponse = respondentsDoc.responses
                        .find(r => r.questionId === c.questionId);
                    return userResponse && 
                           userResponse.answer === c.expectedAnswer;
                })
            );

            // Add selected diseases if outcome exists
            if (outcome && outcome.selectedDiseases) {
                respondentsDoc.selectedDisease = outcome.selectedDiseases;
            }

            // Save the final document
            await respondentsDoc.save();

            // Clear session
            req.session.assessmentData = null;

            return res.json({ 
                completed: true,
                outcome: outcome ? {
                    description: outcome.description,
                    selectedDiseases: outcome.selectedDiseases
                } : null
            });
        }

        // Find next question
        const nextQuestion = assessment.questions.find(
            q => q.questionId === selectedChoiceObj.nextQuestionId
        );

        if (!nextQuestion) {
            return res.status(404).json({ error: "Next question not found" });
        }

        // Update session with new question ID
        req.session.assessmentData.currentQuestionId = nextQuestion.questionId;
        
        // Save the current document with responses
        await respondentsDoc.save();

        // Prepare and send next question
        const formattedQuestion = {
            questionText: nextQuestion.questionText,
            answerType: nextQuestion.answerType,
            choices: nextQuestion.choices.map(choice => ({
                choiceText: choice.choiceText
            }))
        };

        res.json({ question: formattedQuestion });

    } catch (error) {
        console.error('Assessment error:', error);
        res.status(500).json({ error: "Server error" });
    }
});

// Utility function to retrieve assessment responses
async function getAssessmentResponses(proposerId, assessmentType) {
    try {
        const responses = await CdfRespondents.find({ 
            proposerId: proposerId, 
            assessmentType: assessmentType 
        });

        return responses;
    } catch (error) {
        console.error('Error retrieving assessment responses:', error);
        throw error;
    }
}



// API to submit an answer from the proposer (user's response)
app.post('/api/0.0/proposer/:proposerId/assessments/:assessmentType/questions/:questionId/answer', async (req, res) => {

    // find user
    // user is not there create a new user
    // save user response

    const { proposerId, assessmentType, questionId, questionText } = req.params;
    const { answer } = req.body;

    try {
        const assessment = await CdfMaster.findOne({ assessmentType });

        if (!assessment) {
            return res.status(404).json({ error: "Assessment not found" });
        }

        const question = assessment.questions.find(q => q.questionId === questionId);

        if (!question) {
            return res.status(400).json({ error: "Invalid question ID" });
        }

        // Record the user's response in cdf_respondents collection
        let respondent = await CdfRespondents.findOne({ proposerId, assessmentType });

        if (!respondent) {
            respondent = new CdfRespondents({
                proposerId,
                assessmentType,
                assessmentId: assessment.assessmentId,
                responses: []
            });
        }

        respondent.responses.push({
            questionId,
            questionText,
            answer,
        });

        await respondent.save();

        // Determine the next question or outcome based on the provided answer
        const selectedChoice = question.choices.find(choice => choice.choiceText === answer);
        const nextQuestionId = selectedChoice ? selectedChoice.nextQuestionId : null;

        if (nextQuestionId === null) {
            // If no next question, calculate the outcome
            const outcome = assessment.outcomes.find(outcome => {
                return outcome.criteria.every(criterion => {
                    const answeredQuestion = respondent.responses.find(r => r.questionId === criterion.questionId);
                    return answeredQuestion && answeredQuestion.answer === criterion.expectedAnswer;
                });
            });

            return res.json({ message: "Assessment complete", outcome });
        }


        //      Redirect with 302 to /api/0.0/proposer/:proposerId/assessments/:assessmentType/questions/:questionId/{{nextQuestionId}}


        if (nextQuestionId) {
            // Redirect to the next question endpoint
            const nextQuestionUrl = `/api/0.0/assessments/${assessmentType}/questions/${nextQuestionId}`;
            res.redirect(302, nextQuestionUrl);
        } else {
            // Handle the end of the assessment flow if there's no next question
            res.status(200).json({ message: "Assessment completed." });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

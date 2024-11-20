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
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const app = express();
const PORT = 5001;

// MongoDB connection string
const mongoURI = 'mongodb://localhost:27017/underwriting';  // Change this to your actual connection string

// Connect to MongoDB
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected successfully'))
    .catch((err) => console.log('MongoDB connection error: ', err));

// Use JSON parser middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'your-secret-key',  // Change this to a secure secret key
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
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

app.get('/api/cdfmasters', async (req, res) => {
    try {
        const activeAssessments = await CDFMaster.find({ inactive: { $ne: true } });
        res.json(activeAssessments);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching assessments.' });
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
    const { selectedChoice } = req.body;
    
    try {
        // Check if session exists
        if (!req.session.assessmentData) {
            return res.status(400).json({ 
                error: "Assessment session not found. Please start a new assessment." 
            });
        }

        const { currentQuestionId, assessmentType } = req.session.assessmentData;

        const assessment = await CdfMaster.findOne({ assessmentType });

        if (!assessment) {
            return res.status(404).json({ error: "Assessment not found" });
        }

        const currentQuestion = assessment.questions.find(q => q.questionId === currentQuestionId);
        
        if (!currentQuestion) {
            return res.status(404).json({ error: "Current question not found" });
        }

        const selectedChoiceObj = currentQuestion.choices.find(c => c.choiceText === selectedChoice);
        
        if (!selectedChoiceObj) {
            return res.status(400).json({ error: "Invalid choice selected" });
        }

        // Store response
        req.session.assessmentData.userResponses.push({
            questionId: currentQuestionId,
            response: selectedChoice
        });

        // Check if assessment is complete
        if (!selectedChoiceObj.nextQuestionId) {
            const outcome = assessment.outcomes.find(o => 
                o.criteria.every(c => {
                    const userResponse = req.session.assessmentData.userResponses
                        .find(r => r.questionId === c.questionId);
                    return userResponse && userResponse.response === c.expectedAnswer;
                })
            );

            // Clear session
            req.session.assessmentData = null;

            return res.json({ 
                completed: true,
                outcome: outcome ? {
                    description: outcome.description,
                    icd10_code: outcome.icd10_code
                } : null
            });
        }

        // Find and prepare next question
        const nextQuestion = assessment.questions.find(q => 
            q.questionId === selectedChoiceObj.nextQuestionId
        );

        if (!nextQuestion) {
            return res.status(404).json({ error: "Next question not found" });
        }

        // Update session with new question ID
        req.session.assessmentData.currentQuestionId = nextQuestion.questionId;

        // Format response
        const formattedQuestion = {
            questionText: nextQuestion.questionText,
            answerType: nextQuestion.answerType,
            choices: nextQuestion.choices.map(choice => ({
                choiceText: choice.choiceText
            }))
        };

        res.json({ question: formattedQuestion });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});



// API to submit an answer from the proposer (user's response)
app.post('/api/0.0/proposer/:proposerId/assessments/:assessmentType/questions/:questionId/answer', async (req, res) => {
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

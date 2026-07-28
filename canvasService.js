import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Base Canvas API domain and token stored safely in .env
const CANVAS_BASE_URL = 'https://northsouth.instructure.com/api/v1';
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;

// Create a pre-configured Axios instance for Canvas API calls
// The 'Authorization: Bearer <TOKEN>' header is automatically attached to every request!
const canvasClient = axios.create({
    baseURL: CANVAS_BASE_URL,
    headers: {
        'Authorization': `Bearer ${CANVAS_API_TOKEN}`
    }
});

/**
 * 1. Fetch active courses for the student
 * Canvas Endpoint: GET /api/v1/courses
 */
export async function getCourses() {
    try {
        const response = await canvasClient.get('/courses', {
            params: {
                enrollment_state: 'active'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching Canvas courses:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * 2. Fetch recent announcements across all enrolled courses
 * Canvas Endpoint: GET /api/v1/announcements
 */
export async function getAnnouncements() {
    try {
        // First get active courses to construct context codes (e.g. course_12345)
        const courses = await getCourses();
        if (!courses || courses.length === 0) {
            return [];
        }

        const contextCodes = courses.map(course => `course_${course.id}`);

        const response = await canvasClient.get('/announcements', {
            params: {
                'context_codes[]': contextCodes
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching Canvas announcements:', error.response?.data || error.message);
        throw error;
    }
}


export async function getAssignments(courseId) {
    try {
        const response = await canvasClient.get(`/courses/${courseId}/assignments`,{
            params: {
                bucket: 'upcoming',
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching assignments for course ${courseId}:`, error.response?.data || error.message);
        throw error;
    }
}


export async function getGrades(courseId) {
    try {
        const response = await canvasClient.get(`/courses/${courseId}/students/submissions`, {
            params: {
                student_ids: ['self'],
                include: ['assignment']
            }
        });
        const submissions =  response.data;
        const published = getPublishedGrades(submissions);
        return formatGrades(published);
    } catch (error) {
        console.error(`Error fetching grade details for course ${courseId}:`, error.response?.data || error.message);
        throw error;
    }
}

function getPublishedGrades(submissions) {
  return submissions
    .filter(sub => sub.workflow_state === 'graded' && sub.score !== null)
    .map(sub => ({
      name: sub.assignment.name.trim(),      // trim() because "Quiz 01 " has a trailing space in the raw data
      score: sub.score,
      pointsPossible: sub.assignment.points_possible
    }));
}

function formatGrades(publishedGrades) {
  return publishedGrades
    .map(g => `${g.name} : ${g.score}/${g.pointsPossible}`)
    .join('\n');
}



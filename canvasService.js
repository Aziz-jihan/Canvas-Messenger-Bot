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

/**
 * 3. Fetch grades & total scores for enrolled courses
 * Canvas Endpoint: GET /api/v1/courses?include[]=total_scores
 */
export async function getGrades() {
    try {
        const response = await canvasClient.get('/courses', {
            params: {
                enrollment_state: 'active',
                'include[]': ['total_scores']
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching Canvas grades:', error.response?.data || error.message);
        throw error;
    }
}

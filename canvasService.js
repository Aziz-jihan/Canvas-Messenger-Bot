import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL || 'https://northsouth.instructure.com/api/v1';

/**
 * Creates a scoped Axios client for a specific user's Canvas token
 */
function createCanvasClient(canvasToken) {
    return axios.create({
        baseURL: CANVAS_BASE_URL,
        headers: {
            'Authorization': `Bearer ${canvasToken}`
        }
    });
}

/**
 * Test/Validate a user's Canvas token by attempting to fetch self profile/courses
 */
export async function validateToken(canvasToken) {
    try {
        const client = createCanvasClient(canvasToken);
        const response = await client.get('/users/self');
        return { valid: true, user: response.data };
    } catch (error) {
        return { valid: false, error: error.response?.data?.message || 'Invalid Canvas Token' };
    }
}

/**
 * 1. Fetch active courses for a user
 */
export async function getCourses(canvasToken) {
    try {
        const client = createCanvasClient(canvasToken);
        const response = await client.get('/courses', {
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
 * 2. Fetch recent announcements for a user
 */
export async function getAnnouncements(canvasToken) {
    try {
        const courses = await getCourses(canvasToken);
        if (!courses || courses.length === 0) {
            return [];
        }

        const contextCodes = courses.map(course => `course_${course.id}`);
        const client = createCanvasClient(canvasToken);

        const response = await client.get('/announcements', {
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
 * 3. Fetch upcoming assignments for a specific course
 */
export async function getAssignments(canvasToken, courseId) {
    try {
        const client = createCanvasClient(canvasToken);
        const response = await client.get(`/courses/${courseId}/assignments`, {
            params: {
                bucket: 'upcoming'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching assignments for course ${courseId}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * 4. Fetch grade submissions for a specific course
 */
export async function getGrades(canvasToken, courseId) {
    try {
        const client = createCanvasClient(canvasToken);
        const response = await client.get(`/courses/${courseId}/students/submissions`, {
            params: {
                student_ids: ['self'],
                include: ['assignment']
            }
        });
        const submissions = response.data;
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
            name: sub.assignment ? sub.assignment.name.trim() : 'Assignment',
            score: sub.score,
            pointsPossible: sub.assignment ? sub.assignment.points_possible : 100
        }));
}

function formatGrades(publishedGrades) {
    if (!publishedGrades || publishedGrades.length === 0) {
        return "No graded submissions yet.";
    }
    return publishedGrades
        .map(g => `• ${g.name} : ${g.score}/${g.pointsPossible}`)
        .join('\n');
}

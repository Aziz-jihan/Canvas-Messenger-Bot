import { getCourses, getAnnouncements, getGrades } from './canvasService.js';
import { fileURLToPath } from 'url';


export async function Announcements() {
    let output = "📢 Recent Canvas Announcements:\n\n";
    try {
        const announcements = await getAnnouncements(); 
        output += `${announcements.length} recent announcement(s):\n\n`;
        announcements.slice(0, 5).forEach(a => {
            const cleanMessage = a.message ? a.message.replace(/<[^>]*>?/gm, '').substring(0, 80) + '...' : '';

            // Date formatting
            const postedAt = new Date(a.posted_at);
            const day = String(postedAt.getDate()).padStart(2, '0');
            const month = String(postedAt.getMonth() + 1).padStart(2, '0');
            const year = String(postedAt.getFullYear()).slice(-2);
            const formattedDate = `${day}-${month}-${year}`;

            let hours = postedAt.getHours();
            const minutes = String(postedAt.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12; // convert 0 → 12 for 12-hour clock
            const formattedTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

            output += `• ${a.title}\n${formattedDate} at ${formattedTime}\n${cleanMessage}\n\n`;
        });
        return output;

    }catch (error) {
        console.error('Error fetching Canvas announcements:', error.response?.data || error.message);
        throw error;
    }
}


export async function Grades() {
    let output = "📊 Canvas Grades Summary:\n\n";
    try {
        const grades = await getGrades();  

        grades.forEach(g => {
        if(g.enrollments[0].computed_current_score !== null){
        output += `• ${g.name.split(" ")[0]}\n ${g.enrollments[0].computed_current_score}\n`;
        }
    });
    return output;

    }catch (error) {
        console.error('Error fetching Canvas grades:', error.response?.data || error.message);
        throw error;
    }
}

export async function Courses() {
    let output = "📚 Enrolled Canvas Courses:\n\n";
    try {
        const courses = await getCourses();
        courses.forEach(c => {
            output += `•${c.name}\n`;
        });
        return output;

    } catch (error) {
        console.error('Error fetching Canvas courses:', error.response?.data || error.message);
        throw error;
    }
}





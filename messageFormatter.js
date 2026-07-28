import { getCourses, getAnnouncements, getGrades, getAssignments } from './canvasService.js';
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
        const courses = await getCourses();
        const gradePromises = [];

        courses.forEach(course => {
            gradePromises.push(
                getGrades(course.id).then(gradeMessage => {
                    output += `• ${course.name}\n`;
                    output += gradeMessage ? `${gradeMessage}\n\n` : 'No grades available\n\n';
                })
            );
        });

        await Promise.all(gradePromises);
        return output;

    } catch (error) {
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


export async function Assignments() {
    let output = "📝 Upcoming Canvas Assignments:\n\n";
    try {
        const courses = await getCourses();
        for (const course of courses) {
            const assignment = await getAssignments(course.id);
            if (assignment.length > 0) {
                output += `📘 ${course.name.split(" ")[0]}:\n${assignment.name}\n`;
               
                const dueDate = new Date(assignment.due_at);
                const day = String(dueDate.getDate()).padStart(2, '0');
                const month = String(dueDate.getMonth() + 1).padStart(2, '0');
                const year = String(dueDate.getFullYear()).slice(-2);

                let hours = dueDate.getHours();
                const minutes = String(postedAt.getMinutes()).padStart(2, '0');
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12 || 12; // convert 0 → 12 for 12-hour clock
                const formattedTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

                output += `Deadline: ${day}-${month}-${year} ${formattedTime}\n`;
                const cleanDescription = assignment.description ? assignment.description.replace(/<[^>]*>?/gm, '').substring(0, 80) + '...' : '';
                output += `Description: ${cleanDescription}\n\n`;
                output += assignment.points_possible ? `Points Possible: ${assignment.points_possible}\n\n` : '';
                output += "\n\n";
            }
        }
        return output;

    }catch (error) {
        console.error('Error fetching Canvas assignments:', error.response?.data || error.message);
        throw error;
    }
}


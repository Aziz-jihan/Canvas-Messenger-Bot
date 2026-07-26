import { getCourses, getAnnouncements, getGrades } from './canvasService.js';

async function runCanvasTests() {
    console.log('========================================');
    console.log('   Testing Canvas LMS API Integration   ');
    console.log('========================================\n');

    try {
        console.log('1. Fetching Enrolled Courses...');
        const courses = await getCourses();
        console.log(`✅ Success! Found ${courses.length} active course(s):`);
        courses.forEach(c => console.log(`   • [ID: ${c.id}] ${c.name} (${c.course_code || 'No Code'})`));
        console.log('\n----------------------------------------\n');

        console.log('2. Fetching Course Grades...');
        const grades = await getGrades();
        console.log(`✅ Success! Found grades for ${grades.length} course(s):`);
        grades.forEach(g => {
             if(g.enrollments[0].computed_current_score !== null){
                console.log(`Course: ${g.name.split(" ")[0]}, Score: ${g.enrollments[0].computed_current_score}`);
        }
        });
        console.log('\n----------------------------------------\n');

        console.log('3. Fetching Announcements...');
        const announcements = await getAnnouncements();
        console.log(`✅ Success! Found ${announcements.length} recent announcement(s):`);
        announcements.slice(0, 5).forEach(a => {
            const cleanMessage = a.message ? a.message.replace(/<[^>]*>?/gm, '').substring(0, 80) + '...' : '';

            //Date Logic 😑
            const postedAt = new Date(a.posted_at);
            const day = String(postedAt.getDate()).padStart(2, '0');
            const month = String(postedAt.getMonth() + 1).padStart(2, '0');
            const year = String(postedAt.getFullYear()).slice(-2);
            const formattedDate = `${day}-${month}-${year}`;

            let hours = postedAt.getHours();
            const minutes = String(postedAt.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12; // convert 0 → 12 for 12-hour clock
            const formattedTime = `${String(hours).padStart(2, '0')}-${minutes} ${ampm}`;

            console.log(`   •[${formattedDate} at ${formattedTime}] [${a.title}]: ${cleanMessage}`);
        });

        console.log('\n========================================');
        console.log('   🎉 All Canvas API Tests Completed!   ');
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ Canvas API Test Failed!');
        console.error('Make sure CANVAS_BASE_URL and CANVAS_API_TOKEN are set in your .env file.');
        console.error('Error Details:', error.message);
    }
    const grades = await getGrades();
    grades.forEach(g => {
        if(g.enrollments[0].computed_current_score !== null){
        console.log(`Course: ${g.name.split(" ")[0]}, Score: ${g.enrollments[0].computed_current_score}`);
        }
    });
}

runCanvasTests();

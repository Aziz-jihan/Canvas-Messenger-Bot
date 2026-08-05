import { getCourses, getAnnouncements, getGrades } from './canvasService.js';
import 'dotenv/config';

const token = process.env.CANVAS_API_TOKEN;

function buildCourseMap(courses) {
  const map = {};
  courses.forEach(course => {
    map[`course_${course.id}`] = course.name;
  });
  return map;
}


function formatAnnouncement(announcement, courseName) {
  const title = (announcement.title || '').trim();
  const message = announcement.message
    ? announcement.message.replace(/<[^>]*>?/gm, '').substring(0, 500) + '...'
    : '';
  const postedAt = announcement.posted_at;
  const author = announcement.author?.display_name || 'Unknown';
  const attachments = (announcement.attachments || []).map(a => ({
    name: a.display_name,
    url: a.url
  }));

  let output = `Course: ${courseName}\n`;
  output += `📢 ${title}\n`;
  output += `Posted by: ${author}\n`;
  output += `Date: ${new Date(postedAt).toLocaleDateString()}\n\n`;
  output += `${message}\n`;

  if (attachments.length > 0) {
    output += `\n📎 Attachments:\n`;
    attachments.forEach(a => {
      output += `- ${a.name}: ${a.url}\n`;
    });
  }

  return output;
}

const courses = await getCourses(token);
const announcements = await getAnnouncements(token);
const courseMap = buildCourseMap(courses);

let output = '';

announcements.forEach(a => {
  const courseName = courseMap[a.context_code]; 
  output += formatAnnouncement(a, courseName) + '\n\n';
})


console.log(output);



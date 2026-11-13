/**
 * Common job titles by field, for picking target roles on Resume & profile. Any title typed by the user
 * works too — the agent keeps postings whose title contains every word of a target role.
 */
export const ROLE_CATALOG: { field: string; roles: string[] }[] = [
  { field: "Software & IT", roles: ["Software Engineer", "Web Developer", "IT Support Specialist", "Help Desk Technician", "Systems Administrator", "Network Engineer", "QA Analyst", "DevOps Engineer"] },
  { field: "Data & analytics", roles: ["Data Analyst", "Business Analyst", "Data Engineer", "Data Scientist", "Business Intelligence Analyst", "Reporting Analyst"] },
  { field: "Cybersecurity", roles: ["Cybersecurity Analyst", "SOC Analyst", "Security Engineer", "Information Security Analyst"] },
  { field: "Engineering", roles: ["Mechanical Engineer", "Electrical Engineer", "Civil Engineer", "Manufacturing Engineer", "Quality Engineer", "Process Engineer", "Project Engineer"] },
  { field: "Oil, gas & energy", roles: ["Roustabout", "Floorhand", "Field Operator", "Lease Operator", "Pipeline Operator", "Process Operator", "Petroleum Engineer", "Wind Turbine Technician"] },
  { field: "Skilled trades & field", roles: ["Field Service Technician", "Maintenance Technician", "Electrician", "Instrumentation Technician", "HVAC Technician", "Welder", "Diesel Mechanic"] },
  { field: "Healthcare", roles: ["Registered Nurse", "Medical Assistant", "Pharmacy Technician", "Patient Care Technician", "Medical Coder", "Phlebotomist", "Clinical Research Coordinator"] },
  { field: "Finance & accounting", roles: ["Accountant", "Staff Accountant", "Financial Analyst", "Accounts Payable Specialist", "Bookkeeper", "Auditor", "Credit Analyst"] },
  { field: "Banking & insurance", roles: ["Personal Banker", "Bank Teller", "Loan Officer", "Claims Adjuster", "Insurance Agent", "Underwriter"] },
  { field: "Sales & marketing", roles: ["Sales Representative", "Account Executive", "Sales Development Representative", "Marketing Coordinator", "Digital Marketing Specialist", "Social Media Coordinator"] },
  { field: "Customer service & admin", roles: ["Customer Service Representative", "Customer Success Associate", "Administrative Assistant", "Office Coordinator", "Receptionist", "Data Entry Clerk"] },
  { field: "Operations & logistics", roles: ["Operations Analyst", "Supply Chain Analyst", "Logistics Coordinator", "Warehouse Associate", "Inventory Specialist", "Procurement Specialist"] },
  { field: "Retail & hospitality", roles: ["Store Associate", "Assistant Store Manager", "Shift Supervisor", "Front Desk Agent", "Restaurant Manager"] },
  { field: "People, HR & education", roles: ["HR Coordinator", "Recruiter", "Payroll Specialist", "Teacher", "Teaching Assistant", "Training Coordinator"] },
  { field: "Design & media", roles: ["Graphic Designer", "UX Designer", "Video Editor", "Content Writer", "Communications Specialist"] },
];
